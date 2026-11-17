import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { generateMarketingInsight } from '@/lib/marketing/insight.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function PATCH(request: NextRequest) {
  try {
    const access = await getMarketingAccess('manage');
    if (!access.allowed || !access.employee) {
      return NextResponse.json({ error: 'Brak uprawnień do ustawień AI.' }, { status: 403 });
    }
    const body = await request.json();
    const companyId = String(body?.companyId || '');
    const enabled = body?.enabled === true;
    if (!companyId || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowa lub niedostępna marka.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('marketing_company_settings').upsert({
      company_id: companyId,
      ai_analysis_enabled: enabled,
      ai_data_scope: 'aggregates_only',
      ai_consent_at: enabled ? new Date().toISOString() : null,
      ai_consent_by: enabled ? access.employee.id : null,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, enabled });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zapisać ustawień AI.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await getMarketingAccess('manage');
    if (!access.allowed || !access.employee) {
      return NextResponse.json({ error: 'Brak uprawnień do analizy AI.' }, { status: 403 });
    }

    const body = await request.json();
    const companyId = String(body?.companyId || '');
    if (!companyId || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowa lub niedostępna marka.' }, { status: 400 });
    }

    const data = await generateMarketingInsight(access.companyIds, companyId, access.employee.id);
    return NextResponse.json(data);
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    if (status >= 500 && status !== 503) console.error('[marketing AI analysis]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się przygotować analizy AI.' },
      { status },
    );
  }
}
