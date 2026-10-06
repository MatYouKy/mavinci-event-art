import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAdmin } from '@/lib/permissions';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { getOpenAiUsageReport, OpenAiUsageError } from '@/lib/CRM/ai/openAiUsage.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 40;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };

export async function GET(request: NextRequest) {
  try {
    const session = createSupabaseServerClient(await cookies());
    const { data: { user }, error: authError } = await session.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Zaloguj się ponownie, aby zobaczyć statystyki AI.' }, { status: 401, headers });

    // Resolve both current and legacy employee identities from trusted server data.
    // Module permissions alone do not grant access to organization billing.
    const { data: employee, error } = await createSupabaseAdminClient().from('employees')
      .select('role,access_level,permissions')
      .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`).eq('is_active', true).maybeSingle();
    if (error) return NextResponse.json({ error: 'Nie udało się sprawdzić uprawnień administratora.' }, { status: 503, headers });
    if (!isAdmin(employee)) return NextResponse.json({ error: 'Statystyki i rozliczenia AI są dostępne wyłącznie dla administratora.' }, { status: 403, headers });

    return NextResponse.json(await getOpenAiUsageReport(request.nextUrl.searchParams.get('month')), { headers });
  } catch (error) {
    if (error instanceof OpenAiUsageError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: 'Nie udało się wczytać statystyk AI. Spróbuj ponownie.' }, { status: 500, headers });
  }
}
