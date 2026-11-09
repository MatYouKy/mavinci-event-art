/**
 * Adres projektu Supabase z konfiguracji (NEXT_PUBLIC_SUPABASE_URL) — zamiast adresu wpisanego na stałe.
 * Przeniesienie projektu (np. do Frankfurtu, docs/migracja-frankfurt.md) zmienia tylko zmienne środowiska.
 */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');

/** Identyfikator projektu (pierwszy człon hosta *.supabase.co) — np. w nazwie ciasteczka sesji `sb-<ref>-auth-token`. */
export const SUPABASE_PROJECT_REF = (() => {
  try {
    return new URL(SUPABASE_URL).hostname.split('.')[0] || '';
  } catch {
    return '';
  }
})();

/** Publiczny adres pliku w kontenerze Storage. */
export const publicStorageUrl = (bucket: string, path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path.replace(/^\/+/, '')}`;
