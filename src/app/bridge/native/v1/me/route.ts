import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sprawdzenie połączenia aplikacji z natywnym API: kto jest zalogowany (bez uprawnień szczegółowych — te są w kartach). */
export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const { employee } = ctx;
  return nativeJson({ id: employee.id, name: employee.name, surname: employee.surname, isAdmin: employee.isAdmin, api: 1 });
}
