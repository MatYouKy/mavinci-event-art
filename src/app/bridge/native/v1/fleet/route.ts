import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  addAttribute, addFuel, addInsurance, addLicense, addMaintenance, deleteAttribute, deleteInsurance, deleteLicense, deleteMaintenance,
  deleteVehicle, deleteVehicleImage, endUsage, fleetAccess, fleetList, fleetTimeline, fleetVehicle, renameVehicleImage, saveVehicle,
  setPrimaryVehicleImage, uploadReceipt, uploadVehicleImage,
} from '@/lib/native/fleet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Flota dla aplikacji na Maca (`src/lib/native/fleet.ts`): GET op=list | vehicle&id=… | timeline&from=…&to=…[&id=…];
 * POST (JSON) op=save {id?, data} | delete {id} | fuelAdd {vehicleId, data} | maintenanceAdd {vehicleId, kind, data} |
 * maintenanceDelete {id, source} | insuranceAdd {vehicleId, data} | insuranceDelete {id} | endUsage {vehicleId, data} |
 * attributeAdd / attributeDelete | licenseAdd / licenseDelete | imagePrimary {vehicleId, id} | imageDelete {id} | imageTitle {id, title};
 * POST multipart `?op=image&vehicleId=…` (zdjęcie do galerii) | `?op=receipt&vehicleId=…` (paragon, zwraca adres).
 * Tokenem pracownika — dostęp rozstrzyga RLS jak w przeglądarce.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => {
  const value = error as { status?: number; code?: string } | null;
  if (value?.status) return value.status;
  return value?.code === '42501' ? 403 : value?.code ? 400 : 500;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  try {
    switch (op) {
      case 'list':
        return nativeJson(await fleetList(ctx));
      case 'vehicle': {
        const id = url.searchParams.get('id') || '';
        if (!uuid.test(id)) return failure('Nieprawidłowy pojazd.');
        return nativeJson(await fleetVehicle(ctx, id));
      }
      case 'timeline': {
        const id = url.searchParams.get('id') || '';
        if (id && !uuid.test(id)) return failure('Nieprawidłowy pojazd.');
        return nativeJson(await fleetTimeline(ctx, id || null, url.searchParams.get('from') || '', url.searchParams.get('to') || ''));
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-fleet]', error);
    return failure(errorText(error, 'Nie udało się wczytać floty.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const access = fleetAccess(ctx);

  // Pliki: zdjęcie galerii albo paragon tankowania (multipart, pole „file”).
  const uploadOp = url.searchParams.get('op');
  if (uploadOp === 'image' || uploadOp === 'receipt') {
    const vehicleId = url.searchParams.get('vehicleId') || '';
    if (!uuid.test(vehicleId)) return failure('Nieprawidłowy pojazd.');
    if (uploadOp === 'image' && !access.canManage) return failure('Nie masz uprawnień do zmiany galerii.', 403);
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      return nativeJson(uploadOp === 'image' ? await uploadVehicleImage(ctx, vehicleId, file) : await uploadReceipt(ctx, vehicleId, file));
    } catch (error) {
      if (statusOf(error) >= 500) console.error('[native-fleet] upload', error);
      return failure(errorText(error, 'Nie udało się przesłać pliku.'), statusOf(error));
    }
  }

  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  const vehicleId = String(body.vehicleId || '');
  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data as Record<string, any> : {};
  const needs = (value: string, message: string) => {
    if (!uuid.test(value)) throw Object.assign(new Error(message), { status: 400 });
  };
  try {
    switch (op) {
      case 'save':
        if (id) needs(id, 'Nieprawidłowy pojazd.');
        return nativeJson(await saveVehicle(ctx, id || null, data));
      case 'delete':
        needs(id, 'Nieprawidłowy pojazd.');
        if (!access.canManage) return failure('Nie masz uprawnień do usunięcia pojazdu.', 403);
        return nativeJson(await deleteVehicle(ctx, id));
      case 'fuelAdd':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        return nativeJson(await addFuel(ctx, vehicleId, data));
      case 'maintenanceAdd':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        if (!access.canManage) return failure('Nie masz uprawnień do dodawania wpisów serwisowych.', 403);
        return nativeJson(await addMaintenance(ctx, vehicleId, String(body.kind || ''), data));
      case 'maintenanceDelete':
        needs(id, 'Nieprawidłowy wpis serwisowy.');
        return nativeJson(await deleteMaintenance(ctx, id, String(body.source || '')));
      case 'insuranceAdd':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        if (!access.canManage) return failure('Nie masz uprawnień do dodawania polis.', 403);
        return nativeJson(await addInsurance(ctx, vehicleId, data));
      case 'insuranceDelete':
        needs(id, 'Nieprawidłowa polisa.');
        return nativeJson(await deleteInsurance(ctx, id));
      case 'endUsage':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        return nativeJson(await endUsage(ctx, vehicleId, data));
      case 'attributeAdd':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        return nativeJson(await addAttribute(ctx, vehicleId, data));
      case 'attributeDelete':
        needs(id, 'Nieprawidłowa właściwość.');
        return nativeJson(await deleteAttribute(ctx, id));
      case 'licenseAdd':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        return nativeJson(await addLicense(ctx, vehicleId, data));
      case 'licenseDelete':
        needs(id, 'Nieprawidłowe wymaganie.');
        return nativeJson(await deleteLicense(ctx, id));
      case 'imagePrimary':
        needs(vehicleId, 'Nieprawidłowy pojazd.');
        needs(id, 'Nieprawidłowe zdjęcie.');
        return nativeJson(await setPrimaryVehicleImage(ctx, vehicleId, id));
      case 'imageDelete':
        needs(id, 'Nieprawidłowe zdjęcie.');
        return nativeJson(await deleteVehicleImage(ctx, id));
      case 'imageTitle':
        needs(id, 'Nieprawidłowe zdjęcie.');
        return nativeJson(await renameVehicleImage(ctx, id, body.title));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-fleet]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
