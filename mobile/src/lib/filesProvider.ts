import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { MavinciFiles } from '../../modules/mavinci-files';
import { supabaseAnonKey, supabaseUrl } from './supabase';

/*
 * „Mavinci” w aplikacji Pliki na iPhonie i iPadzie (Przeglądaj → Lokalizacje, obok iCloud Drive) — to samo rozszerzenie
 * File Provider co „Mavinci” w Finderze na Macu: Eventy, Materiały i Dysk, z uprawnieniami konta jak w CRM.
 *
 * Rozszerzenie działa jako osobny proces (także przy zamkniętej aplikacji) z własną sesją tego samego konta
 * (`/bridge/native/v1/device-session`) — wspólna sesja wylogowywałaby aplikację przy odświeżaniu tokenu. Aplikacja po
 * zalogowaniu i przy każdym powrocie na pierwszy plan sprawdza, czy lokalizacja jest zarejestrowana dla tego konta
 * (i prosi o sprawdzenie zmian), a przy wylogowaniu unieważnia sesję rozszerzenia i usuwa lokalizację.
 * Wymaga iOS 16 i wersji aplikacji z rozszerzeniem (EAS Build); w starszej wersji i na Androidzie nic nie robi.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
/** Po nieudanej próbie (np. brak sieci) kolejna automatyczna najwcześniej po 5 minutach. */
const RETRY_AFTER = 5 * 60_000;
const REQUEST_TIMEOUT = 20_000;

const native = Platform.OS === 'ios' ? MavinciFiles : null;

/** Moduł obecny (iPhone/iPad, wersja aplikacji z rozszerzeniem) — o iOS 16 i grupie aplikacji mówi `filesProviderState`. */
export const filesProviderSupported = Boolean(native);

export type FilesProviderState = { available: boolean; enabled: boolean };

let inflight: Promise<void> | null = null;
let failedAt = 0;
/** Zmienia się przy wylogowaniu — rejestracja rozpoczęta wcześniej nie dokończy się po nim. */
let generation = 0;
/** Zmiany w natywnej części (rejestracja, wylogowanie) po kolei. */
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

/** Stan lokalizacji „Mavinci” dla zalogowanego konta (zarejestrowana z sesją tego konta). */
export async function filesProviderState(userId: string | null | undefined): Promise<FilesProviderState> {
  if (!native) return { available: false, enabled: false };
  try {
    const status = await native.status();
    return { available: status.available, enabled: status.available && status.enabled && !!userId && status.userId === userId };
  } catch {
    return { available: false, enabled: false };
  }
}

/** Lokalizacja zarejestrowana dla konta z `session` — bez błędów (nieudana próba wraca po 5 minutach). */
export function ensureFilesProvider(session: Session | null): Promise<void> {
  if (!native || !session?.access_token || !session.user?.id) return Promise.resolve();
  if (inflight) return inflight;
  const run = register(session, false)
    .catch((error) => {
      failedAt = Date.now();
      console.warn('[Pliki] Nie udało się dodać Mavinci do aplikacji Pliki:', error instanceof Error ? error.message : error);
    })
    .finally(() => { if (inflight === run) inflight = null; });
  inflight = run;
  return run;
}

/** Ustawienia → „Dodaj ponownie”: nowa sesja rozszerzenia i rejestracja; błąd trafia do wywołującego. */
export async function repairFilesProvider(session: Session | null): Promise<void> {
  if (!native) throw new Error('Ta wersja aplikacji nie ma rozszerzenia Plików — zaktualizuj aplikację.');
  if (!session?.access_token || !session.user?.id) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  if (inflight) await inflight;
  const run = register(session, true);
  const tracked: Promise<void> = run.catch(() => undefined).finally(() => { if (inflight === tracked) inflight = null; });
  inflight = tracked;
  await run;
  failedAt = 0;
}

async function register(session: Session, force: boolean): Promise<void> {
  const files = native!;
  const started = generation;
  const status = await files.status();
  if (!status.available) {
    if (force) throw new Error('Mavinci w aplikacji Pliki wymaga iOS 16 lub nowszego.');
    return;
  }
  if (!force && status.enabled && status.userId === session.user.id) return;
  if (!force && Date.now() - failedAt < RETRY_AFTER) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  let body: { session?: Record<string, unknown>; error?: string } = {};
  try {
    const response = await fetch(`${CRM_URL}/bridge/native/v1/device-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json' },
      signal: controller.signal,
    });
    body = await response.json().catch(() => ({}));
    if (!response.ok || !body.session) throw new Error(body.error || `Serwer odpowiedział błędem (${response.status}).`);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Serwer nie odpowiada. Spróbuj ponownie później.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const deviceSession = body.session;

  await serial(async () => {
    if (generation !== started) {
      // Wylogowanie w trakcie — nowa sesja rozszerzenia nie zostaje.
      await revoke(deviceSession);
      return;
    }
    const connection = { url: supabaseUrl, publicKey: supabaseAnonKey, native: false, crm: CRM_URL };
    await files.enable(JSON.stringify(connection), JSON.stringify(deviceSession));
  });
}

/** Unieważnienie sesji rozszerzenia, której nie zapisaliśmy (wylogowanie w trakcie rejestracji). */
async function revoke(deviceSession: Record<string, unknown>) {
  const token = typeof deviceSession.access_token === 'string' ? deviceSession.access_token : '';
  if (!token || !supabaseUrl) return;
  try {
    await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    // Bez sieci sesja wygaśnie sama (token odświeżania nigdzie nie trafił).
  }
}

/** Wylogowanie: sesja rozszerzenia unieważniona, lokalizacja usunięta. Czeka najwyżej 8 s (dalej kończy się w tle). */
export async function disableFilesProvider(): Promise<void> {
  if (!native) return;
  generation += 1;
  failedAt = 0;
  const done = serial(() => native.disable()).catch((error) => {
    console.warn('[Pliki] Nie udało się usunąć Mavinci z aplikacji Pliki:', error instanceof Error ? error.message : error);
  });
  await Promise.race([done, new Promise<void>((resolve) => { setTimeout(() => resolve(), 8_000); })]);
}

/** Prośba do aplikacji Pliki o sprawdzenie zmian; `driveChanged` — plik dodany w aplikacji do Dysku. */
export function signalFilesProvider(driveChanged = false): void {
  if (!native) return;
  native.signal(driveChanged).catch(() => undefined);
}
