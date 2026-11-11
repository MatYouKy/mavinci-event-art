import { randomUUID } from 'node:crypto';
import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  equipmentDetail, invalidateWarehouse, isWarehouseSet, saveEquipment, warehouseAccess, warehouseDictionaries, warehouseSetItems,
  warehouseSetKeys, warehouseSetState,
} from '@/lib/native/warehouse';
import {
  addCompatible, addComponent, createCable, deleteCable, deleteCompatible, deleteComponent, deleteConnector, deleteFile, deleteImage,
  deleteRental, deleteWarehouseCategory, renameFile, saveCableCategory, saveConnector, saveKit, saveWarehouseCategory, setPrimaryImage,
  updateCable, updateCompatible, updateComponent, updateRental, uploadConnectorThumb, uploadEquipmentFile, uploadGalleryImage, uploadRentalImage,
} from '@/lib/native/warehouseOps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Magazyn dla aplikacji na Maca — katalog (`/crm/equipment`), karta sprzętu (`/crm/equipment/[id]`), jednostki i ich zdarzenia
 * (`UnitsTab`, `UnitEventsModal`), skład zestawu, galeria, pliki, zestawy (`/crm/equipment/kits`), duplikowanie i usuwanie jak w CRM.
 * Zbiory (katalog, karty, zestawy, przewody) synchronizowane przyrostowo na dysk Maca. Tokenem pracownika — RLS jak w przeglądarce.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const day = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const UNIT_STATUSES = ['available', 'damaged', 'in_service', 'retired'];
const EVENT_TYPES = ['note', 'inspection', 'service', 'repair', 'damage', 'sold'];
const today = () => new Date().toISOString().slice(0, 10);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = warehouseAccess(ctx);
  if (!access.canView) return failure('Nie masz dostępu do magazynu.', 403);
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const id = url.searchParams.get('id') || '';
  try {
    if (op === 'state') {
      // Katalog (jak dotąd: `hash`) i pozostałe zbiory (`h_details`, `h_kits`, `h_cables`) — skróty koszyków tylko dla zmienionych.
      const others = warehouseSetKeys.filter((key) => key !== 'catalog');
      const [state, dictionaries, ...sets] = await Promise.all([
        warehouseSetState(ctx, 'catalog', url.searchParams.get('hash') || undefined),
        warehouseDictionaries(ctx),
        // Błąd jednego zbioru (np. brak dostępu do tabeli wynajmu) nie zatrzymuje pozostałych — Mac pominie ten zbiór.
        ...others.map((key) => warehouseSetState(ctx, key, url.searchParams.get(`h_${key}`) || undefined).catch((error) => {
          console.error('[native-warehouse] set', key, error);
          return null;
        })),
      ]);
      const ready = others.map((key, i) => [key, sets[i]] as const).filter(([, value]) => value !== null);
      return nativeJson({ ...state, access, ...dictionaries, sets: Object.fromEntries(ready) });
    }
    if (op === 'detail') {
      if (!uuid.test(id)) return failure('Nieprawidłowy sprzęt.');
      const detail = await equipmentDetail(ctx, id);
      return detail ? nativeJson(detail) : failure('Nie znaleziono sprzętu.', 404);
    }
    if (op === 'unitEvents') {
      if (!uuid.test(id)) return failure('Nieprawidłowa jednostka.');
      const { data, error } = await ctx.supabase.from('equipment_unit_events').select('id,event_type,description,image_url,old_status,new_status,created_at,employees(name,surname)')
        .eq('unit_id', id).order('created_at', { ascending: false });
      if (error) throw error;
      return nativeJson({
        events: (data || []).map((row: any) => ({
          id: String(row.id), type: String(row.event_type || 'note'), description: String(row.description || ''), imageUrl: row.image_url || null,
          oldStatus: row.old_status || '', newStatus: row.new_status || '', at: row.created_at || null,
          author: [row.employees?.name, row.employees?.surname].filter(Boolean).join(' '),
        })),
      });
    }
    return failure('Nieznana operacja.');
  } catch (error) {
    console.error('[native-warehouse]', op, error);
    return failure(errorText(error, 'Nie udało się pobrać danych magazynu.'), 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = warehouseAccess(ctx);
  if (!access.canView) return failure('Nie masz dostępu do magazynu.', 403);
  const url = new URL(request.url);

  // Galeria i pliki sprzętu: multipart (`?op=gallery|file&equipmentId=…`, pole „file”) → `equipment-images` / `equipment-files`.
  const uploadOp = url.searchParams.get('op');
  if (uploadOp === 'gallery' || uploadOp === 'file') {
    if (!access.canManage) return failure('Nie masz uprawnień do zmiany sprzętu.', 403);
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      const equipmentId = url.searchParams.get('equipmentId') || '';
      const problem = uploadOp === 'gallery' ? await uploadGalleryImage(ctx, equipmentId, file) : await uploadEquipmentFile(ctx, equipmentId, file);
      return problem ? failure(problem) : nativeJson({ ok: true });
    } catch (error) {
      console.error('[native-warehouse] upload', error);
      return failure(errorText(error, 'Nie udało się przesłać pliku.'), 500);
    }
  }

  // Miniatura wtyka (`connector-thumbnails`) i zdjęcie sprzętu wynajmu (`rental-equipment-images`) — zwracają adres.
  if (uploadOp === 'connectorThumb' || uploadOp === 'rentalImage') {
    if (!access.canManage) return failure('Nie masz uprawnień do zmiany magazynu.', 403);
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      if (file.size > 10 * 1024 * 1024) return failure(`${file.name} przekracza 10MB`);
      const result = uploadOp === 'connectorThumb'
        ? await uploadConnectorThumb(ctx, file)
        : await uploadRentalImage(ctx, url.searchParams.get('equipmentId') || '', file);
      return result.error ? failure(result.error) : nativeJson({ ok: true, url: result.url });
    } catch (error) {
      console.error('[native-warehouse] upload', error);
      return failure(errorText(error, 'Nie udało się przesłać zdjęcia.'), 500);
    }
  }

  // Zdjęcia (miniatura sprzętu lub zestawu, zdjęcie zdarzenia): multipart (`?op=image&folder=…`, pole „file”) → `site-images` jak `uploadImage`.
  if (uploadOp === 'image') {
    if (!access.canManage) return failure('Nie masz uprawnień do zmiany sprzętu.', 403);
    const requested = url.searchParams.get('folder');
    const folder = requested && ['equipment-events', 'equipment-kits', 'equipment-images'].includes(requested) ? requested : 'equipment-thumbnails';
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      if (!(file.type || '').startsWith('image/')) return failure('Plik musi być obrazem');
      if (file.size > 6 * 1024 * 1024) return failure('Zdjęcie jest większe niż 6 MB.');
      const path = `${folder}/${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;
      const upload = await ctx.supabase.storage.from('site-images').upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: file.type || 'image/jpeg', cacheControl: '3600', upsert: false,
      });
      if (upload.error) return failure(`Błąd podczas przesyłania zdjęcia: ${upload.error.message}`);
      const { data: { publicUrl } } = ctx.supabase.storage.from('site-images').getPublicUrl(path);
      return nativeJson({ ok: true, url: publicUrl });
    } catch (error) {
      console.error('[native-warehouse] image', error);
      return failure(errorText(error, 'Nie udało się przesłać zdjęcia.'), 500);
    }
  }

  let body: Record<string, any>;
  try {
    body = await readJson(request, 512_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, any>) : {};
  if (op !== 'items' && !access.canManage && !((op === 'create' || op === 'cableCreate') && access.canCreate)) return failure('Nie masz uprawnień do zmiany magazynu.', 403);
  try {
    switch (op) {
      case 'items':
        return nativeJson(await warehouseSetItems(ctx, isWarehouseSet(body.set) ? body.set : 'catalog', Array.isArray(body.buckets) ? body.buckets : []));

      case 'create': {
        // Nowy sprzęt: podstawowe dane (resztę uzupełnia się na karcie) i opcjonalnie pierwsze jednostki.
        const name = optionalText(data.name);
        if (!name) return failure('Nazwa jest wymagana.');
        const { data: created, error } = await ctx.supabase.from('equipment_items').insert({
          name, brand: optionalText(data.brand), model: optionalText(data.model), description: optionalText(data.description),
          warehouse_category_id: uuid.test(String(data.categoryId || '')) ? data.categoryId : null,
          storage_location_id: uuid.test(String(data.locationId || '')) ? data.locationId : null,
          thumbnail_url: optionalText(data.thumbnailUrl),
        }).select('id').single();
        if (error) return failure(errorText(error, 'Nie udało się dodać sprzętu.'));
        const count = Math.max(0, Math.min(200, Math.round(Number(data.units) || 0)));
        if (count > 0) {
          const units = Array.from({ length: count }, () => ({
            equipment_id: created.id, status: 'available', location_id: uuid.test(String(data.locationId || '')) ? data.locationId : null,
          }));
          await ctx.supabase.from('equipment_units').insert(units);
        }
        invalidateWarehouse();
        return nativeJson({ ok: true, id: created.id });
      }

      case 'update': {
        if (!uuid.test(id)) return failure('Nieprawidłowy sprzęt.');
        const problem = await saveEquipment(ctx, id, data);
        return problem ? failure(problem) : nativeJson({ ok: true });
      }

      case 'delete': {
        if (!uuid.test(id)) return failure('Nieprawidłowy sprzęt.');
        const table = body.kind === 'kit' ? 'equipment_kits' : 'equipment_items';
        const { data: removed, error } = await ctx.supabase.from(table).delete().eq('id', id).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas usuwania'));
        if (!removed?.length) return failure('Nie masz uprawnień do usunięcia.', 403);
        invalidateWarehouse();
        return nativeJson({ ok: true });
      }

      case 'duplicate': {
        if (!uuid.test(id)) return failure('Nieprawidłowy sprzęt.');
        const { data: original, error: readError } = await ctx.supabase.from('equipment_items').select('*').eq('id', id).single();
        if (readError) return failure(errorText(readError, 'Błąd podczas duplikowania'));
        const { error } = await ctx.supabase.from('equipment_items').insert({
          name: `${original.name} (kopia)`, warehouse_category_id: original.warehouse_category_id, brand: original.brand, model: original.model,
          description: original.description, thumbnail_url: original.thumbnail_url, dimensions_cm: original.dimensions_cm,
          weight_kg: original.weight_kg, storage_location_id: original.storage_location_id,
        });
        if (error) return failure(errorText(error, 'Błąd podczas duplikowania'));
        invalidateWarehouse();
        return nativeJson({ ok: true });
      }

      case 'unitSave': {
        const equipmentId = String(body.equipmentId || '');
        if (!uuid.test(equipmentId)) return failure('Nieprawidłowy sprzęt.');
        const status = UNIT_STATUSES.includes(String(data.status)) ? String(data.status) : 'available';
        const fields = {
          status, location_id: uuid.test(String(data.locationId || '')) ? data.locationId : null, condition_notes: optionalText(data.notes),
          purchase_date: day(data.purchaseDate), last_service_date: day(data.lastServiceDate), estimated_repair_date: day(data.repairDate),
          thumbnail_url: optionalText(data.thumbnailUrl),
        };
        const serial = optionalText(data.serial);
        if (uuid.test(id)) {
          const { error } = await ctx.supabase.from('equipment_units').update({ ...fields, unit_serial_number: serial }).eq('id', id).eq('equipment_id', equipmentId);
          if (error) return failure(errorText(error, 'Nie udało się zapisać jednostki.'));
        } else {
          const count = Math.max(1, Math.min(200, Math.round(Number(body.count) || 1)));
          const units = Array.from({ length: count }, (_, i) => ({
            equipment_id: equipmentId, ...fields, unit_serial_number: serial ? (count > 1 ? `${serial} #${i + 1}` : serial) : null,
          }));
          const { error } = await ctx.supabase.from('equipment_units').insert(units);
          if (error) return failure(errorText(error, 'Nie udało się dodać jednostki.'));
        }
        invalidateWarehouse();
        return nativeJson({ ok: true });
      }

      case 'unitDelete': {
        const ids = (Array.isArray(body.ids) ? body.ids : [id]).map(String).filter((value: string) => uuid.test(value));
        if (!ids.length) return failure('Nieprawidłowa jednostka.');
        const { error } = await ctx.supabase.from('equipment_units').delete().in('id', ids);
        if (error) return failure(errorText(error, 'Nie udało się usunąć jednostki.'));
        invalidateWarehouse();
        return nativeJson({ ok: true });
      }

      case 'unitDuplicate': {
        const ids = (Array.isArray(body.ids) ? body.ids : [id]).map(String).filter((value: string) => uuid.test(value));
        if (!ids.length) return failure('Nieprawidłowa jednostka.');
        const { data: units, error: readError } = await ctx.supabase.from('equipment_units').select('*').in('id', ids);
        if (readError) throw readError;
        const copies = (units || []).map((unit: any) => ({
          equipment_id: unit.equipment_id, unit_serial_number: unit.unit_serial_number ? `${unit.unit_serial_number} (duplikat)` : null,
          status: unit.status, location_id: unit.location_id,
          condition_notes: unit.condition_notes ? `${unit.condition_notes} [DUPLIKAT]` : 'Duplikat jednostki',
          purchase_date: unit.purchase_date, last_service_date: unit.last_service_date, estimated_repair_date: unit.estimated_repair_date,
          thumbnail_url: unit.thumbnail_url,
        }));
        if (copies.length) {
          const { error } = await ctx.supabase.from('equipment_units').insert(copies);
          if (error) return failure(errorText(error, 'Nie udało się zduplikować jednostki.'));
        }
        invalidateWarehouse();
        return nativeJson({ ok: true });
      }

      case 'unitEvent': {
        // Zdarzenie jak `UnitEventsModal`: uszkodzenie → „Uszkodzony”, naprawa → dostępny + data serwisu, serwis → data serwisu,
        // sprzedaż → usunięcie jednostki.
        const unitId = String(body.unitId || '');
        const type = String(body.type || 'note');
        const description = optionalText(body.description);
        if (!uuid.test(unitId)) return failure('Nieprawidłowa jednostka.');
        if (!EVENT_TYPES.includes(type)) return failure('Nieznany typ zdarzenia.');
        if (!description) return failure('Wprowadź opis zdarzenia');
        const { data: unit } = await ctx.supabase.from('equipment_units').select('status').eq('id', unitId).maybeSingle();
        const { error } = await ctx.supabase.from('equipment_unit_events').insert({
          unit_id: unitId, event_type: type, description, image_url: optionalText(body.imageUrl), employee_id: ctx.employee.id,
          old_status: unit?.status ?? null,
          new_status: type === 'damage' ? 'damaged' : type === 'repair' ? 'available' : unit?.status ?? null,
        });
        if (error) return failure(errorText(error, 'Nie udało się dodać zdarzenia.'));
        let message = 'Zdarzenie dodane';
        if (type === 'damage') {
          await ctx.supabase.from('equipment_units').update({ status: 'damaged' }).eq('id', unitId);
          message = 'Status jednostki został zmieniony na „Uszkodzony”';
        } else if (type === 'repair') {
          await ctx.supabase.from('equipment_units').update({ status: 'available', estimated_repair_date: null, last_service_date: today() }).eq('id', unitId);
          message = 'Jednostka została naprawiona i jest znowu dostępna!';
        } else if (type === 'service') {
          await ctx.supabase.from('equipment_units').update({ last_service_date: today() }).eq('id', unitId);
          message = 'Data ostatniego serwisu została zaktualizowana!';
        } else if (type === 'sold') {
          await ctx.supabase.from('equipment_units').delete().eq('id', unitId);
          message = 'Jednostka została usunięta z systemu jako sprzedana.';
        }
        invalidateWarehouse();
        return nativeJson({ ok: true, message });
      }

      case 'cableQuantity': {
        const equipmentId = String(body.equipmentId || '');
        const quantity = Math.round(Number(body.quantity));
        if (!uuid.test(equipmentId) || !Number.isFinite(quantity) || quantity < 0) return failure('Podaj poprawną ilość.');
        const { error } = await ctx.supabase.from('equipment_items').update({ cable_stock_quantity: quantity }).eq('id', equipmentId);
        if (error) return failure(errorText(error, 'Nie udało się zapisać ilości.'));
        invalidateWarehouse();
        return nativeJson({ ok: true });
      }

      case 'componentAdd':
      case 'componentUpdate':
      case 'componentDelete':
      case 'compatibleAdd':
      case 'compatibleUpdate':
      case 'compatibleDelete':
      case 'imagePrimary':
      case 'imageDelete':
      case 'fileRename':
      case 'fileDelete': {
        const equipmentId = String(body.equipmentId || '');
        const problem = op === 'componentAdd' ? await addComponent(ctx, equipmentId, data)
          : op === 'componentUpdate' ? await updateComponent(ctx, id, data)
          : op === 'componentDelete' ? await deleteComponent(ctx, id)
          : op === 'compatibleAdd' ? await addCompatible(ctx, equipmentId, data)
          : op === 'compatibleUpdate' ? await updateCompatible(ctx, id, data)
          : op === 'compatibleDelete' ? await deleteCompatible(ctx, id)
          : op === 'imagePrimary' ? await setPrimaryImage(ctx, equipmentId, id)
          : op === 'imageDelete' ? await deleteImage(ctx, id)
          : op === 'fileRename' ? await renameFile(ctx, id, body.name)
          : await deleteFile(ctx, id);
        return problem ? failure(problem) : nativeJson({ ok: true });
      }

      case 'cableCreate': {
        const result = await createCable(ctx, data);
        return result.error ? failure(result.error) : nativeJson({ ok: true, id: result.id });
      }

      case 'cableUpdate':
      case 'cableDelete':
      case 'cableCategorySave':
      case 'connectorSave':
      case 'connectorDelete':
      case 'categorySave':
      case 'categoryDelete':
      case 'rentalUpdate':
      case 'rentalDelete': {
        const problem = op === 'cableUpdate' ? await updateCable(ctx, id, data)
          : op === 'cableDelete' ? await deleteCable(ctx, id)
          : op === 'cableCategorySave' ? await saveCableCategory(ctx, data)
          : op === 'connectorSave' ? await saveConnector(ctx, uuid.test(id) ? id : null, data)
          : op === 'connectorDelete' ? await deleteConnector(ctx, id)
          : op === 'categorySave' ? await saveWarehouseCategory(ctx, uuid.test(id) ? id : null, data)
          : op === 'categoryDelete' ? await deleteWarehouseCategory(ctx, id)
          : op === 'rentalUpdate' ? await updateRental(ctx, id, data)
          : await deleteRental(ctx, id);
        return problem ? failure(problem) : nativeJson({ ok: true });
      }

      case 'kitSave': {
        const result = await saveKit(ctx, uuid.test(id) ? id : null, data, Array.isArray(body.items) ? body.items : []);
        return result.error ? failure(result.error) : nativeJson({ ok: true, id: result.id });
      }

      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-warehouse]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
