import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { PERMISSION_SCOPE_GROUPS } from '@/lib/permissionCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Nazwy uprawnień jak w CRM (`src/lib/permissionCatalog.ts`) dla aplikacji na Maca i telefonu — karta pracownika
 * w Ustawieniach → „Tryb testowy” (`docs/test-mode.md`). Sam słownik (grupy, nazwy, opisy) — bez danych pracowników;
 * dla każdego zalogowanego pracownika. GET → `{ groups: [{ key, label, scopes: [{ key, label, description }] }] }`.
 */
export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  return nativeJson({
    groups: PERMISSION_SCOPE_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      scopes: group.scopes.map((scope) => ({ key: scope.key, label: scope.label, description: scope.description })),
    })),
  });
}
