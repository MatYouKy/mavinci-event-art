import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  syncMarketingIntegration,
  updateExternalCampaignStatus,
} from '@/lib/marketing/sync.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function cronIsAuthorised(request: NextRequest) {
  const expected = process.env.MARKETING_CRON_SECRET;
  return Boolean(expected && request.headers.get('x-marketing-cron-secret') === expected);
}

export async function POST(request: NextRequest) {
  try {
    const isCron = cronIsAuthorised(request);
    const body = await request.json().catch(() => ({}));
    const companyId = body?.companyId ? String(body.companyId) : null;
    let companyIds: string[] = [];

    if (!isCron) {
      const access = await getMarketingAccess('manage');
      if (!access.allowed) {
        return NextResponse.json({ error: 'Brak uprawnień do synchronizacji.' }, { status: 403 });
      }
      if (companyId && !canAccessMarketingCompany(access, companyId)) {
        return NextResponse.json({ error: 'Brak dostępu do wybranej marki.' }, { status: 403 });
      }
      companyIds = companyId ? [companyId] : access.companyIds;
    } else if (companyId) {
      companyIds = [companyId];
    }

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('marketing_integrations')
      .select('id, company_id, provider, settings, credentials_encrypted')
      .not('credentials_encrypted', 'is', null);
    if (companyIds.length) query = query.in('company_id', companyIds);
    const { data: integrations, error } = await query;
    if (error) throw error;

    let integrationsToSync = integrations || [];
    if (isCron && integrationsToSync.length > 0) {
      const { data: disabledSettings, error: settingsError } = await admin
        .from('marketing_company_settings')
        .select('company_id')
        .eq('automatic_sync_enabled', false);
      if (settingsError) throw settingsError;
      const disabledCompanies = new Set((disabledSettings || []).map((item) => item.company_id));
      integrationsToSync = integrationsToSync.filter(
        (integration) => !disabledCompanies.has(integration.company_id),
      );
    }

    const results = [];
    for (const integration of integrationsToSync) {
      results.push(await syncMarketingIntegration(integration as any));
    }

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      synced: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    });
  } catch (error: any) {
    console.error('[marketing sync]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zsynchronizować danych.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await getMarketingAccess('manage');
    if (!access.allowed) {
      return NextResponse.json({ error: 'Brak uprawnień do zarządzania kampaniami.' }, { status: 403 });
    }
    const body = await request.json();
    const companyId = String(body?.companyId || '');
    const campaignId = String(body?.campaignId || '');
    const status = body?.status === 'ACTIVE' ? 'ACTIVE' : body?.status === 'PAUSED' ? 'PAUSED' : null;
    if (!companyId || !campaignId || !status || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowe dane kampanii.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data: campaign, error: campaignError } = await admin
      .from('marketing_campaigns')
      .select('provider, external_campaign_id, integration_id')
      .eq('id', campaignId)
      .eq('company_id', companyId)
      .single();
    if (campaignError) throw campaignError;
    const { data: integration, error: integrationError } = await admin
      .from('marketing_integrations')
      .select('id, company_id, provider, settings, credentials_encrypted')
      .eq('id', campaign.integration_id)
      .single();
    if (integrationError) throw integrationError;

    await updateExternalCampaignStatus(integration as any, campaign as any, status);
    return NextResponse.json({ ok: true, status });
  } catch (error: any) {
    console.error('[marketing campaign status]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zmienić statusu kampanii.' },
      { status: 500 },
    );
  }
}
