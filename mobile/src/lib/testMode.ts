import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/*
 * Tryb testowy „widok jako” w telefonie (`docs/test-mode.md`) — stan i przekierowanie zapytań do bazy. Administrator wchodzi
 * w widok pracownika (Ustawienia → „Tryb testowy”, `src/lib/testModeApi.ts`): serwer CRM wydaje sesję zastępczą, a klient
 * Supabase (`src/lib/supabase.ts`, `testModeFetch`) wysyła wtedy zapytania nie do Supabase, tylko do serwera CRM
 * (`/bridge/test-mode/sb`), który podstawia klucz tej osoby — odczyt jak u niej, zapis do bazy wycofany, pliki, funkcje
 * serwera i zmiany konta zablokowane. Natywne API (`/bridge/native/v1/*`) przyjmuje klucz zastępczy wprost (tylko odczyty).
 * Stan jest zapisany na telefonie (także sesja administratora do przywrócenia), więc tryb przetrwa ponowne uruchomienie
 * aplikacji; wyjście — pasek „Wyjdź z trybu” (`TestModeBanner`), Ustawienia albo „Wyloguj”.
 * Bez importu klienta Supabase — importuje go `supabase.ts` (wejście i wyjście z trybu: `testModeApi.ts`).
 */

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
export const TEST_MODE_CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const STATE_KEY = 'mavinci.testMode.v1';

export type TestModeState = {
  /** Sesja testowa na serwerze CRM. */
  id: string;
  /** Kogo oglądamy (imię i nazwisko · poziom dostępu). */
  label: string;
  /** Koniec sesji testowej (ms) — serwer kończy ją po 8 godzinach. */
  expiresAt: number;
  /** Adres, przez który idą zapytania do bazy (`<CRM>/bridge/test-mode/sb`). */
  proxy: string;
  /** Klucz zastępczy z wejścia — wskazuje sesję testową przy wyjściu (`/bridge/test-mode/exit`). */
  token: string;
  /** Sesja administratora do przywrócenia po wyjściu. */
  admin: { access_token: string; refresh_token: string };
};

let state: TestModeState | null = null;
let switching = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

function parse(raw: string | null): TestModeState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TestModeState>;
    if (typeof value.id !== 'string' || typeof value.token !== 'string' || typeof value.proxy !== 'string') return null;
    if (!value.proxy.startsWith(`${TEST_MODE_CRM_URL}/`)) return null;
    if (!value.admin || typeof value.admin.access_token !== 'string' || typeof value.admin.refresh_token !== 'string') return null;
    return {
      id: value.id,
      label: typeof value.label === 'string' ? value.label : '',
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : 0,
      proxy: value.proxy,
      token: value.token,
      admin: { access_token: value.admin.access_token, refresh_token: value.admin.refresh_token },
    };
  } catch {
    return null;
  }
}

/** Odczyt zapisanego stanu (raz na uruchomienie; kolejne wywołania czekają na ten sam odczyt). */
export function loadTestMode(): Promise<void> {
  if (!loading) {
    loading = AsyncStorage.getItem(STATE_KEY)
      .then((raw) => { state = parse(raw); })
      .catch(() => { state = null; })
      .finally(notify);
  }
  return loading;
}

/** Trwający tryb testowy (stan w pamięci — po `loadTestMode`). */
export const currentTestMode = () => state;
/** Trwa wejście w tryb albo wyjście z niego (sesja w kliencie Supabase jest właśnie podmieniana). */
export const testModeSwitching = () => switching;

export function setTestModeSwitching(value: boolean) {
  switching = value;
  notify();
}

/** Nowy stan: w pamięci od razu (kolejne zapytania już według niego), potem na telefonie. */
export async function saveTestMode(next: TestModeState | null) {
  state = next;
  loading = Promise.resolve();
  notify();
  if (next) await AsyncStorage.setItem(STATE_KEY, JSON.stringify(next));
  else await AsyncStorage.removeItem(STATE_KEY);
}

export function subscribeTestMode(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Stan trybu testowego dla widoków (pasek, Ustawienia). */
export function useTestMode() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeTestMode(() => setVersion((value) => value + 1));
    // Stan mógł zostać odczytany, zanim widok zaczął słuchać zmian — odświeżenie po odczycie.
    void loadTestMode().then(() => { if (active) setVersion((value) => value + 1); });
    return () => { active = false; unsubscribe(); };
  }, []);
  return { testMode: state, switching };
}

/**
 * `fetch` klienta Supabase: w trybie testowym zapytania do Supabase idą do serwera CRM (`/bridge/test-mode/sb`), który
 * podstawia klucz oglądanej osoby. Poza trybem — bez zmian. Zapytania do innych adresów (serwer CRM, pliki) — bez zmian.
 */
export const testModeFetch: typeof fetch = async (input, init) => {
  await loadTestMode();
  const current = state;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!current || !SUPABASE_URL || !url.startsWith(`${SUPABASE_URL}/`)) return fetch(input, init);
  const target = `${current.proxy}${url.slice(SUPABASE_URL.length)}`;
  if (typeof input === 'string' || input instanceof URL) return fetch(target, init);
  return fetch(new Request(target, input), init);
};
