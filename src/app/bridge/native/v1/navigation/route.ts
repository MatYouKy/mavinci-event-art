import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { navigationForUser } from '@/lib/CRM/navigation/getNavigationForUser.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Menu CRM dla aplikacji na Maca — ta sama lista, kolejność (`navigation_order`) i uprawnienia co pasek boczny w przeglądarce. */
export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const { navigation } = await navigationForUser(ctx.supabase, ctx.employee.authUserId);
  return nativeJson({ navigation });
}
