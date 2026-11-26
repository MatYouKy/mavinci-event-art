import { supabase } from './supabase';
import {
  TEST_MODE_CRM_URL,
  currentTestMode,
  saveTestMode,
  setTestModeSwitching,
  testModeSwitching,
  type TestModeState,
} from './testMode';

/*
 * Tryb testowy „widok jako” w telefonie (`docs/test-mode.md`, stan: `testMode.ts`): lista pracowników i dziennik wejść
 * (`test_mode_targets`, `test_mode_history` — tylko administrator), wejście w widok pracownika (`/bridge/test-mode/start`
 * kluczem administratora → sesja zastępcza w kliencie Supabase) i wyjście (sesja administratora wraca, sesja testowa
 * kończy się na serwerze). Sprzedawców zewnętrznych (portal) sprawdza się w CRM w przeglądarce.
 */

export type TestModeTarget = {
  id: string;
  name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  occupation: string | null;
  department: string | null;
  access_level: string | null;
  permissions: number | null;
};

export type TestModeHistoryRow = {
  id: string;
  admin: string | null;
  kind: 'employee' | 'seller';
  target: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  active: boolean;
};

const END_REASONS: Record<string, string> = {
  exit: 'Wyjście z trybu',
  expired: 'Wygasła',
  replaced: 'Zastąpiona nowym wejściem',
  rollback_unconfirmed: 'Przerwana (baza nie potwierdziła wycofania zapisu)',
};

export const testModeEndText = (row: TestModeHistoryRow) => (row.active ? 'Trwa' : END_REASONS[row.end_reason || ''] || 'Zakończona');

/** Działy jak w CRM (`teamAvailability.DEPARTMENTS`): pusty albo nieznany — Biuro. */
export const TEST_MODE_DEPARTMENTS: Array<{ value: string; label: string }> = [
  { value: 'management', label: 'Zarząd' },
  { value: 'sales', label: 'Sprzedaż' },
  { value: 'office', label: 'Biuro' },
  { value: 'warehouse', label: 'Magazyn' },
];
export const testModeDepartment = (value: string | null) =>
  value === 'management' || value === 'sales' || value === 'warehouse' ? value : 'office';

const databaseError = (error: { code?: string; message?: string }) => {
  if (error.code === 'PGRST202') return 'Tryb testowy wymaga migracji 20261202100000_crm_test_mode.sql.';
  if (error.code === '42501') return 'Tryb testowy jest dostępny tylko dla administratora.';
  return error.message || 'Nie udało się wczytać listy.';
};

/** Pracownicy do obejrzenia (aktywni, z kontem, bez administratorów i bez siebie) i liczba sprzedawców z portalem. */
export async function loadTestModeTargets(): Promise<{ employees: TestModeTarget[]; sellers: number }> {
  const { data, error } = await supabase.rpc('test_mode_targets');
  if (error) throw new Error(databaseError(error));
  const value = (data || {}) as { employees?: TestModeTarget[]; sellers?: unknown[] };
  return { employees: Array.isArray(value.employees) ? value.employees : [], sellers: Array.isArray(value.sellers) ? value.sellers.length : 0 };
}

/** Dziennik wejść (ostatnie sesje testowe administratorów). */
export async function loadTestModeHistory(): Promise<TestModeHistoryRow[]> {
  const { data, error } = await supabase.rpc('test_mode_history', { p_limit: 20 });
  if (error) return [];
  return Array.isArray(data) ? (data as TestModeHistoryRow[]) : [];
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'x-mavinci-client': 'phone',
});

/** Zakończenie sesji testowej na serwerze (bez czekania na wynik — serwer i tak kończy ją po 8 godzinach). */
function closeOnServer(token: string) {
  void fetch(`${TEST_MODE_CRM_URL}/bridge/test-mode/exit`, { method: 'POST', headers: headers(token), body: '{}' }).catch(() => undefined);
}

/** Wejście w widok pracownika; zwraca opis oglądanej osoby. */
export async function enterTestMode(employeeId: string): Promise<string> {
  if (currentTestMode() || testModeSwitching()) throw new Error('Tryb testowy jest już włączony — najpierw wyjdź z trybu.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  let response: Response;
  try {
    response = await fetch(`${TEST_MODE_CRM_URL}/bridge/test-mode/start`, {
      method: 'POST',
      headers: headers(session.access_token),
      body: JSON.stringify({ kind: 'employee', id: employeeId }),
    });
  } catch {
    throw new Error('Brak połączenia z serwerem CRM. Spróbuj ponownie.');
  }
  const body = (await response.json().catch(() => null)) as {
    id?: string; label?: string; proxy?: string; expires_at?: number; error?: string;
    session?: { access_token?: string; refresh_token?: string };
  } | null;
  const placeholder = body?.session;
  if (!response.ok || !body?.id || !body.proxy?.startsWith('/') || !placeholder?.access_token || !placeholder.refresh_token) {
    throw new Error(body?.error || `Nie udało się włączyć trybu testowego (HTTP ${response.status}).`);
  }
  const next: TestModeState = {
    id: body.id,
    label: body.label || '',
    expiresAt: (body.expires_at || 0) * 1000,
    proxy: `${TEST_MODE_CRM_URL}${body.proxy}`,
    token: placeholder.access_token,
    admin: { access_token: session.access_token, refresh_token: session.refresh_token },
  };
  setTestModeSwitching(true);
  try {
    await saveTestMode(next);
    // Sesja zastępcza w kliencie Supabase — sprawdzenie (profil osoby) idzie już przez serwer CRM.
    const { error } = await supabase.auth.setSession({ access_token: placeholder.access_token, refresh_token: placeholder.refresh_token });
    if (error) {
      await saveTestMode(null);
      await supabase.auth.setSession(next.admin).catch(() => undefined);
      closeOnServer(next.token);
      throw new Error('Nie udało się otworzyć widoku tej osoby. Spróbuj ponownie.');
    }
  } catch (error) {
    if (currentTestMode()) {
      await saveTestMode(null).catch(() => undefined);
      await supabase.auth.setSession(next.admin).catch(() => undefined);
      closeOnServer(next.token);
    }
    throw error instanceof Error ? error : new Error('Nie udało się włączyć trybu testowego.');
  } finally {
    setTestModeSwitching(false);
  }
  return next.label;
}

let exiting: Promise<void> | null = null;

/**
 * Wyjście z trybu testowego: zapytania znów idą do Supabase, wraca sesja administratora (odświeżana, gdy wygasła), sesja
 * testowa kończy się na serwerze. Sesji administratora nie da się przywrócić — wylogowanie (logowanie od nowa).
 */
export function exitTestMode(): Promise<void> {
  if (exiting) return exiting;
  const current = currentTestMode();
  if (!current) return Promise.resolve();
  setTestModeSwitching(true);
  exiting = (async () => {
    try {
      await saveTestMode(null);
      const { error } = await supabase.auth.setSession(current.admin);
      closeOnServer(current.token);
      if (error) {
        // Wylogowanie ma dotrzeć do aplikacji (ekran logowania) — już poza podmianą sesji.
        setTestModeSwitching(false);
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
    } finally {
      setTestModeSwitching(false);
      exiting = null;
    }
  })();
  return exiting;
}
