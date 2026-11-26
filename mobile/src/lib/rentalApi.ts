import * as FileSystem from 'expo-file-system/legacy';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { uploadRentalFile, uploadRentalPhoto, type RentalFileArea, type RentalFileKind } from './rental';

/*
 * Rental → Wypożyczenia klientom w telefonie. Odczyty i zapisy — wspólny `rental.ts` (kopia `src/lib/CRM/rental/rental.ts`):
 * te same funkcje bazy `rental_*` co CRM i Mac, tokenem pracownika — co widzi sprzedaż, a co magazyn, liczy baza (`rental_access`).
 * Katalog magazynu z wolnymi sztukami — `rentalCatalog` we wspólnym `rental.ts` (wprost z bazy). Słowniki formularzy (klienci, firmy,
 * pracownicy, pojazdy, faktury) i PDF protokołu do podpisu — serwer CRM
 * (`/bridge/native/v1/rental`, `src/lib/native/rental.ts`). Zdjęcia i skany — prosto do magazynu `rental-files`.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/rental`;

export type RentalClientHit = { kind: 'organization' | 'contact'; id: string; name: string };
export type RentalOption = { id: string; name: string };
export type RentalOptions = { companies: RentalOption[]; employees: RentalOption[]; vehicles: RentalOption[] };
export type RentalInvoiceHit = { id: string; invoice_number: string; total_gross: number };
/** Zdjęcie z aparatu / galerii albo plik z „Plików” (expo-image-picker, expo-document-picker). */
export type RentalAsset = { uri: string; name?: string | null; fileName?: string | null; mimeType?: string | null };

async function headers(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return { Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json' };
}

async function rentalGet<T>(op: string, params: Record<string, string> = {}): Promise<T> {
  const query = Object.entries({ op, ...params }).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers() });
  } catch {
    throw new Error('Brak połączenia z serwerem CRM. Spróbuj ponownie.');
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

/** Klienci z bazy (organizacje i osoby, min. 2 znaki). */
export const searchRentalClients = async (q: string) => (await rentalGet<{ clients: RentalClientHit[] }>('clients', { q })).clients;
/** Firmy, pracownicy (opiekun, kierowca) i pojazdy floty. */
export const loadRentalOptions = () => rentalGet<RentalOptions>('options');
/** Faktury z Finansów po numerze (min. 2 znaki). */
export const searchRentalInvoices = async (q: string) => (await rentalGet<{ invoices: RentalInvoiceHit[] }>('invoices', { q })).invoices;
/** PDF protokołu do podpisu (generowany na serwerze) — podpisany adres na 10 minut. */
export const rentalProtocolPdf = (rentalId: string, protocolId: string) =>
  rentalGet<{ url: string; name: string }>('protocolPdf', { id: rentalId, protocol: protocolId });

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp', pdf: 'application/pdf',
};

async function readAsset(asset: RentalAsset, fallbackName: string) {
  const rawName = asset.name || asset.fileName || asset.uri.split('/').pop() || fallbackName;
  const extension = rawName.includes('.') ? rawName.split('.').pop()!.toLowerCase() : '';
  const type = asset.mimeType || MIME_BY_EXTENSION[extension] || 'application/octet-stream';
  const name = extension ? rawName : `${rawName}.${type === 'application/pdf' ? 'pdf' : 'jpg'}`;
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  const body = decodeBase64(base64);
  return { body, name, type, size: body.byteLength };
}

/** Skan, zdjęcie albo dokument do wypożyczenia (wpis w plikach; skan — przy protokole). */
export async function uploadRentalAsset(rentalId: string, asset: RentalAsset, area: RentalFileArea, kind: RentalFileKind, protocolId: string | null = null) {
  return uploadRentalFile(supabase, rentalId, await readAsset(asset, kind === 'document' ? 'dokument' : 'skan'), area, kind, protocolId);
}

/** Zdjęcie do linii protokołu (przed zapisem protokołu) — zwraca ścieżkę w magazynie. */
export async function uploadRentalProtocolAsset(rentalId: string, asset: RentalAsset) {
  return uploadRentalPhoto(supabase, rentalId, await readAsset(asset, 'zdjecie'));
}
