import * as FileSystem from 'expo-file-system/legacy';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase } from './supabase';
import {
  EQUIPMENT_CHECKLIST_RPC,
  EQUIPMENT_RETURN_PHOTO_BUCKET,
  type EquipmentChecklist,
  type EquipmentStageKey,
  equipmentReturnPhotoPath,
  equipmentShortageDecisionLines,
  isEquipmentChecklistMissing,
  parseEquipmentChecklist,
} from './equipmentChecklist';

/*
 * Checklista sprzętu wydarzenia w aplikacji — te same RPC co CRM (migracja 20261105170000_event_equipment_checklist.sql,
 * docs/equipment-checklist.md). Etapy, uprawnienia (`can`), blokady i komunikaty liczy baza; tu tylko wywołanie,
 * odczyt wyniku (wspólna kopia equipmentChecklist.ts), rozpoznanie braku funkcji / dostępu i wysyłka zdjęć zwrotu.
 * Każda funkcja zmieniająca checklistę zwraca jej aktualny stan.
 */

/** Komunikat przy bazie bez migracji checklisty (brak funkcji). */
export const EQUIPMENT_DATABASE_UPDATE_MESSAGE = 'Wymaga aktualizacji bazy';

type RpcError = { code?: string; message?: string } | null | undefined;

export type EquipmentChecklistLoad =
  | { status: 'ready'; checklist: EquipmentChecklist }
  /** RPC niewdrożone — ekran pokazuje dawną listę tylko do odczytu i „Wymaga aktualizacji bazy”. */
  | { status: 'missing' }
  /** Brak dostępu (42501) — osoba nie ma obszaru „Realizacja” tego wydarzenia. */
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

/** Komunikat błędu po polsku: baza zwraca gotowe zdania, błąd sieci zamieniamy na „Brak połączenia”. */
export function equipmentErrorMessage(error: unknown, fallback: string): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  if (/Failed to fetch|Network request failed|fetch failed/i.test(message)) {
    return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  }
  return message || fallback;
}

function isRpcMissing(error: RpcError): boolean {
  return isEquipmentChecklistMissing(error) || ['PGRST202', '42883'].includes(error?.code ?? '');
}

export async function fetchEquipmentChecklist(eventId: string, signal?: AbortSignal): Promise<EquipmentChecklistLoad> {
  try {
    const request = supabase.rpc(EQUIPMENT_CHECKLIST_RPC.get, { p_event: eventId });
    const { data, error } = await (signal ? request.abortSignal(signal) : request);
    if (error) {
      if (isRpcMissing(error)) return { status: 'missing' };
      if (error.code === '42501') {
        return { status: 'denied', message: error.message || 'Brak dostępu do sprzętu wydarzenia.' };
      }
      return { status: 'error', message: equipmentErrorMessage(error, 'Nie udało się pobrać checklisty sprzętu.') };
    }
    const checklist = parseEquipmentChecklist(data);
    if (!checklist) return { status: 'error', message: 'Baza zwróciła nieczytelną checklistę sprzętu. Spróbuj ponownie.' };
    return { status: 'ready', checklist };
  } catch (error) {
    return { status: 'error', message: equipmentErrorMessage(error, 'Nie udało się pobrać checklisty sprzętu.') };
  }
}

/** Wywołanie funkcji zmieniającej checklistę; błąd (komunikat z bazy) — wyjątek z polskim komunikatem. */
async function mutate(fn: string, args: Record<string, unknown>): Promise<EquipmentChecklist> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isRpcMissing(error)) {
      throw new Error(`${EQUIPMENT_DATABASE_UPDATE_MESSAGE} — checklista sprzętu nie jest jeszcze wdrożona.`);
    }
    throw new Error(equipmentErrorMessage(error, 'Nie udało się zapisać zmiany na checkliście.'));
  }
  const checklist = parseEquipmentChecklist(data);
  if (!checklist) throw new Error('Zapisano, ale baza zwróciła nieczytelną checklistę. Odśwież ekran.');
  return checklist;
}

/** Braki, o których decyduje sprzedawca / administrator (p_lines) — wynik wspólnego `equipmentShortageDecisionLines`. */
export type EquipmentShortageDecisionLine = ReturnType<typeof equipmentShortageDecisionLines>[number];

const text = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
};

export const equipmentChecklistApi = {
  /** Etap 1: ilość spakowana (null = odznacz); mniej niż na liście (pozycja wymagana) → powód ≥ 3 znaki. */
  pack: (lineId: string, qty: number | null, reason?: string | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.pack, { p_line: lineId, p_qty: qty, p_reason: qty == null ? null : text(reason) }),
  /** „Wszystko zgodne” — niesprawdzone pozycje pełną ilością na etapie. */
  fill: (eventId: string, stage: EquipmentStageKey) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.fill, { p_event: eventId, p_stage: stage }),
  requestApproval: (eventId: string, note?: string | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.requestApproval, { p_event: eventId, p_note: text(note) }),
  /**
   * Zgoda / odmowa na braki (odmowa: notatka, co magazyn ma zrobić). `lines` — braki, które osoba widzi
   * (`equipmentShortageDecisionLines`); gdy ilości zmieniły się w międzyczasie, baza odrzuca decyzję
   * („Lista braków zmieniła się — odśwież i sprawdź ponownie.”).
   */
  decideShortages: (eventId: string, approve: boolean, note: string | null | undefined, lines: EquipmentShortageDecisionLine[]) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.decideShortages, {
      p_event: eventId,
      p_approve: approve,
      p_note: text(note),
      p_lines: lines,
    }),
  confirmDispatch: (eventId: string, note?: string | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.confirmDispatch, { p_event: eventId, p_note: text(note) }),
  requestUnlock: (eventId: string, reason: string) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.requestUnlock, { p_event: eventId, p_reason: text(reason) }),
  reopen: (eventId: string, stage: EquipmentStageKey, reason: string) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.reopen, { p_event: eventId, p_stage: stage, p_reason: text(reason) }),
  /** Etap 2: ile wraca z wydanego (null = odznacz); mniej → opis ≥ 3 znaki. */
  loadback: (lineId: string, qty: number | null, note?: string | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.loadback, { p_line: lineId, p_qty: qty, p_note: qty == null ? null : text(note) }),
  confirmLoadback: (eventId: string, note?: string | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.confirmLoadback, { p_event: eventId, p_note: text(note) }),
  /**
   * Etap 3: sprawne / uszkodzone (brak liczy baza), opis, zdjęcia. `ok` null = odznacz;
   * `photos` null = bez zmiany zdjęć, lista = pełna nowa lista ścieżek.
   */
  returnLine: (lineId: string, ok: number | null, damaged: number, note: string | null | undefined, photos: string[] | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.returnLine, {
      p_line: lineId,
      p_ok: ok,
      p_damaged: ok == null ? 0 : damaged,
      p_note: ok == null ? null : text(note),
      p_photos: photos,
    }),
  confirmReturn: (eventId: string, note?: string | null) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.confirmReturn, { p_event: eventId, p_note: text(note) }),
  /** Przyjęcie rozbieżności zwrotu przez sprzedawcę / administratora (notatka 5–1000 znaków). */
  ackIssues: (eventId: string, note: string) =>
    mutate(EQUIPMENT_CHECKLIST_RPC.ackIssues, { p_event: eventId, p_note: text(note) }),
};

export type EquipmentPhotoAsset = { uri: string; mimeType?: string | null; fileName?: string | null };

/**
 * Wysyła zdjęcie zwrotu do bucketu `event-files` pod ścieżką akceptowaną przez bazę
 * (`<wydarzenie>/equipment-return/<pozycja>/…`) i zwraca tę ścieżkę. Zapis listy zdjęć — `returnLine`.
 */
export async function uploadEquipmentReturnPhoto(eventId: string, lineId: string, asset: EquipmentPhotoAsset): Promise<string> {
  const mimeType = asset.mimeType || 'image/jpeg';
  const extension =
    asset.fileName?.split('.').pop()?.toLowerCase() ||
    (mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/heic' ? 'heic' : 'jpg');
  // Wspólna ścieżka dodaje czas i losową część — kilka zdjęć wybranych naraz nie nadpisuje się.
  const path = equipmentReturnPhotoPath(eventId, lineId, `zwrot.${extension}`);
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const { error } = await supabase.storage
    .from(EQUIPMENT_RETURN_PHOTO_BUCKET)
    .upload(path, decodeBase64(base64), { contentType: mimeType, upsert: false });
  if (error) throw new Error(equipmentErrorMessage(error, 'Nie udało się wysłać zdjęcia.'));
  return path;
}

/** Usuwa wysłane zdjęcia, których nie udało się dopisać do pozycji (bez błędu, gdy się nie uda). */
export async function discardEquipmentReturnPhotos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await supabase.storage.from(EQUIPMENT_RETURN_PHOTO_BUCKET).remove(paths);
  } catch {
    // Plik bez odnośnika w bazie — nie blokuje pracy.
  }
}

/** Adres miniatury zdjęcia zwrotu (bucket publiczny). */
export function equipmentReturnPhotoUrl(path: string): string {
  return supabase.storage.from(EQUIPMENT_RETURN_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
