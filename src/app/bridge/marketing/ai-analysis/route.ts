import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { getMarketingOverview } from '@/lib/marketing/data.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function extractResponseText(response: any) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

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

    const admin = createSupabaseAdminClient();
    const { data: consent, error: consentError } = await admin
      .from('marketing_company_settings')
      .select('ai_analysis_enabled, ai_data_scope')
      .eq('company_id', companyId)
      .maybeSingle();
    if (consentError) throw consentError;
    if (!consent?.ai_analysis_enabled || consent.ai_data_scope !== 'aggregates_only') {
      return NextResponse.json(
        {
          error:
            'Najpierw włącz analizę AI i zaakceptuj przekazywanie zagregowanych wyników tej marki.',
        },
        { status: 412 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Analiza AI wymaga konfiguracji OPENAI_API_KEY po stronie serwera.' },
        { status: 503 },
      );
    }

    const overview = await getMarketingOverview(access.companyIds, companyId);
    const model = process.env.OPENAI_MARKETING_MODEL || 'gpt-5.4';
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 29);
    const snapshot = {
      company: 'Analizowana marka',
      period: {
        start: periodStart.toISOString().slice(0, 10),
        end: periodEnd.toISOString().slice(0, 10),
      },
      totals: overview.totals,
      integrations: overview.integrations.map((integration) => ({
        provider: integration.provider,
        status: integration.status,
        lastSyncedAt: integration.last_synced_at,
      })),
      campaigns: overview.campaigns.slice(0, 20).map((campaign) => ({
        channel: campaign.provider,
        objective: campaign.objective || 'unspecified',
        status: campaign.status,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        spend: campaign.spend,
        conversions: campaign.conversions,
        conversionValue: campaign.conversion_value,
      })),
    };

    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: 'system',
            content:
              'Jesteś analitykiem marketingowym CRM dla polskiej firmy eventowej. Analizujesz wyłącznie dostarczone zagregowane dane. Nie wymyślaj brakujących wyników. Priorytetyzuj konkretne, mierzalne decyzje dotyczące budżetu, kampanii i SEO. Odpowiadaj po polsku.',
          },
          {
            role: 'user',
            content: `Przeanalizuj ostatnie 30 dni i zaproponuj najlepszy kierunek działań dla marki. Dane:\n${JSON.stringify(snapshot)}`,
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'marketing_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string' },
                recommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      title: { type: 'string' },
                      rationale: { type: 'string' },
                      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                      channel: { type: 'string' },
                    },
                    required: ['title', 'rationale', 'priority', 'channel'],
                  },
                },
                risks: { type: 'array', items: { type: 'string' } },
                opportunities: { type: 'array', items: { type: 'string' } },
              },
              required: ['summary', 'recommendations', 'risks', 'opportunities'],
            },
          },
        },
      }),
      cache: 'no-store',
    });
    const responseBody = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      throw new Error(responseBody?.error?.message || 'Usługa AI nie zwróciła analizy.');
    }
    const responseText = extractResponseText(responseBody);
    if (!responseText) throw new Error('Usługa AI zwróciła pustą odpowiedź.');
    const analysis = JSON.parse(responseText);

    const { data, error } = await admin
      .from('marketing_ai_insights')
      .insert({
        company_id: companyId,
        period_start: snapshot.period.start,
        period_end: snapshot.period.end,
        summary: analysis.summary,
        recommendations: analysis.recommendations,
        risks: analysis.risks,
        opportunities: analysis.opportunities,
        model,
        input_snapshot: snapshot,
        created_by: access.employee.id,
      })
      .select('id, summary, recommendations, risks, opportunities, model, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[marketing AI analysis]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się przygotować analizy AI.' },
      { status: 500 },
    );
  }
}
