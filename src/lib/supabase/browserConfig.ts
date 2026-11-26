import { TEST_MODE_COOKIE, TEST_MODE_PROXY_PATH, readCookie } from '@/lib/testMode/shared';
import { SUPABASE_PROJECT_REF } from './projectUrl';

/**
 * Adres i opcje klienta Supabase w przeglądarce. W trybie testowym „widok jako” (`docs/test-mode.md`) zapytania idą przez
 * serwer CRM (`/bridge/test-mode/sb`), który podstawia klucz oglądanej osoby; ciasteczko sesji ma tę samą nazwę co zwykle.
 */
export function browserClientConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (typeof document === 'undefined' || !readCookie(document.cookie, TEST_MODE_COOKIE)) {
    return { url, options: undefined };
  }
  return {
    url: `${window.location.origin}${TEST_MODE_PROXY_PATH}`,
    options: { cookieOptions: { name: `sb-${SUPABASE_PROJECT_REF}-auth-token` } },
  };
}
