import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { getMarketingOverview } from '@/lib/marketing/data.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const access = await getMarketingAccess('view');
    if (!access.allowed || !access.employee) {
      return NextResponse.json({ error: 'Brak dostępu do marketingu.' }, { status: 403 });
    }

    const requestedCompanyId = request.nextUrl.searchParams.get('companyId');
    if (requestedCompanyId && !canAccessMarketingCompany(access, requestedCompanyId)) {
      return NextResponse.json({ error: 'Brak dostępu do wybranej marki.' }, { status: 403 });
    }

    const preferences = ((access.employee as any).preferences || {}) as Record<string, any>;
    const preferredCompanyId = requestedCompanyId || preferences.marketing?.companyId || null;
    const overview = await getMarketingOverview(access.companyIds, preferredCompanyId);
    return NextResponse.json(overview);
  } catch (error: any) {
    console.error('[marketing overview]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się pobrać danych marketingowych.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await getMarketingAccess('view');
    if (!access.allowed || !access.employee) {
      return NextResponse.json({ error: 'Brak dostępu do marketingu.' }, { status: 403 });
    }

    const body = await request.json();
    const companyId = String(body?.companyId || '');
    if (!companyId || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowa lub niedostępna marka.' }, { status: 400 });
    }

    if (typeof body?.automaticSyncEnabled === 'boolean') {
      const manageAccess = await getMarketingAccess('manage');
      if (!manageAccess.allowed || !manageAccess.employee) {
        return NextResponse.json(
          { error: 'Brak uprawnień do ustawień synchronizacji.' },
          { status: 403 },
        );
      }
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from('marketing_company_settings').upsert({
        company_id: companyId,
        automatic_sync_enabled: body.automaticSyncEnabled,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, automaticSyncEnabled: body.automaticSyncEnabled });
    }

    const preferences = ((access.employee as any).preferences || {}) as Record<string, any>;
    const nextPreferences = {
      ...preferences,
      marketing: { ...(preferences.marketing || {}), companyId },
    };
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('employees')
      .update({ preferences: nextPreferences })
      .eq('id', access.employee.id);
    if (error) throw error;

    return NextResponse.json({ ok: true, companyId });
  } catch (error: any) {
    console.error('[marketing preference]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zapisać wybranej marki.' },
      { status: 500 },
    );
  }
}
