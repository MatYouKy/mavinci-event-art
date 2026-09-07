import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import type {
  MarketingDailyMetric,
  MarketingIntegrationDTO,
  MarketingMetricTotals,
  MarketingOverviewDTO,
} from './types';

const EMPTY_TOTALS: MarketingMetricTotals = {
  impressions: 0,
  clicks: 0,
  spend: 0,
  conversions: 0,
  conversionValue: 0,
  reach: 0,
  engagement: 0,
  messages: 0,
  organicClicks: 0,
  organicImpressions: 0,
  averagePosition: 0,
};

const asNumber = (value: unknown) => Number(value || 0);

export async function getMarketingOverview(
  companyIds: string[],
  preferredCompanyId?: string | null,
): Promise<MarketingOverviewDTO> {
  const admin = createSupabaseAdminClient();
  let companiesQuery = admin
    .from('my_companies')
    .select('id, name, legal_name, logo_url, website, is_default, is_active')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name');

  if (companyIds.length > 0) companiesQuery = companiesQuery.in('id', companyIds);
  const { data: companies, error: companiesError } = await companiesQuery;
  if (companiesError) throw companiesError;

  const availableCompanies = companies || [];
  const selectedCompanyId =
    availableCompanies.find((company) => company.id === preferredCompanyId)?.id ||
    availableCompanies.find((company) => company.is_default)?.id ||
    availableCompanies[0]?.id ||
    null;

  if (!selectedCompanyId) {
    return {
      companies: [],
      selectedCompanyId: null,
      integrations: [],
      metrics: [],
      totals: { ...EMPTY_TOTALS },
      campaigns: [],
      messages: [],
      unreadMessages: 0,
      latestInsight: null,
      settings: {
        automaticSyncEnabled: true,
        aiAnalysisEnabled: false,
        aiDataScope: 'aggregates_only',
        aiConsentAt: null,
      },
    };
  }

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 29);
  const from = dateFrom.toISOString().slice(0, 10);

  const [integrationsResult, metricsResult, campaignsResult, messagesResult, unreadCountResult, insightResult, settingsResult] =
    await Promise.all([
      admin
        .from('marketing_integrations')
        .select(
          'id, company_id, provider, status, display_name, external_account_id, settings, scopes, token_expires_at, last_synced_at, last_error, updated_at',
        )
        .eq('company_id', selectedCompanyId)
        .order('provider'),
      admin
        .from('marketing_metrics_daily')
        .select('*')
        .eq('company_id', selectedCompanyId)
        .gte('metric_date', from)
        .order('metric_date'),
      admin
        .from('marketing_campaigns')
        .select(
          'id, provider, external_campaign_id, name, status, objective, budget_daily, budget_lifetime, currency, impressions, clicks, spend, conversions, conversion_value, synced_at',
        )
        .eq('company_id', selectedCompanyId)
        .order('spend', { ascending: false })
        .limit(30),
      admin
        .from('marketing_messages')
        .select(
          'id, provider, sender_name, sender_external_id, message_preview, received_at, is_read, external_thread_id',
        )
        .eq('company_id', selectedCompanyId)
        .order('received_at', { ascending: false })
        .limit(20),
      admin
        .from('marketing_messages')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', selectedCompanyId)
        .eq('is_read', false),
      admin
        .from('marketing_ai_insights')
        .select('id, summary, recommendations, risks, opportunities, model, created_at')
        .eq('company_id', selectedCompanyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('marketing_company_settings')
        .select('automatic_sync_enabled, ai_analysis_enabled, ai_data_scope, ai_consent_at')
        .eq('company_id', selectedCompanyId)
        .maybeSingle(),
    ]);

  for (const result of [
    integrationsResult,
    metricsResult,
    campaignsResult,
    messagesResult,
    unreadCountResult,
    insightResult,
    settingsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const metrics: MarketingDailyMetric[] = (metricsResult.data || []).map((metric: any) => ({
    id: metric.id,
    company_id: metric.company_id,
    source: metric.source,
    metric_date: metric.metric_date,
    external_campaign_id: metric.external_campaign_id || '',
    campaign_name: metric.campaign_name,
    currency: metric.currency || 'PLN',
    impressions: asNumber(metric.impressions),
    clicks: asNumber(metric.clicks),
    spend: asNumber(metric.spend),
    conversions: asNumber(metric.conversions),
    conversionValue: asNumber(metric.conversion_value),
    reach: asNumber(metric.reach),
    engagement: asNumber(metric.engagement),
    messages: asNumber(metric.messages),
    organicClicks: asNumber(metric.organic_clicks),
    organicImpressions: asNumber(metric.organic_impressions),
    averagePosition: asNumber(metric.average_position),
  }));

  const totals = metrics.reduce<MarketingMetricTotals>(
    (sum, metric) => ({
      impressions: sum.impressions + metric.impressions,
      clicks: sum.clicks + metric.clicks,
      spend: sum.spend + metric.spend,
      conversions: sum.conversions + metric.conversions,
      conversionValue: sum.conversionValue + metric.conversionValue,
      reach: sum.reach + metric.reach,
      engagement: sum.engagement + metric.engagement,
      messages: sum.messages + metric.messages,
      organicClicks: sum.organicClicks + metric.organicClicks,
      organicImpressions: sum.organicImpressions + metric.organicImpressions,
      averagePosition: sum.averagePosition,
    }),
    { ...EMPTY_TOTALS },
  );
  const positionRows = metrics.filter(
    (metric) => metric.source === 'google_search_console' && metric.averagePosition > 0,
  );
  totals.averagePosition = positionRows.length
    ? positionRows.reduce((sum, metric) => sum + metric.averagePosition, 0) /
      positionRows.length
    : 0;

  const messages = (messagesResult.data || []) as MarketingOverviewDTO['messages'];

  return {
    companies: availableCompanies,
    selectedCompanyId,
    integrations: (integrationsResult.data || []) as MarketingIntegrationDTO[],
    metrics,
    totals,
    campaigns: (campaignsResult.data || []).map((campaign: any) => ({
      ...campaign,
      budget_daily: campaign.budget_daily == null ? null : asNumber(campaign.budget_daily),
      budget_lifetime:
        campaign.budget_lifetime == null ? null : asNumber(campaign.budget_lifetime),
      impressions: asNumber(campaign.impressions),
      clicks: asNumber(campaign.clicks),
      spend: asNumber(campaign.spend),
      conversions: asNumber(campaign.conversions),
      conversion_value: asNumber(campaign.conversion_value),
    })),
    messages,
    unreadMessages: unreadCountResult.count || 0,
    latestInsight: (insightResult.data as MarketingOverviewDTO['latestInsight']) || null,
    settings: {
      automaticSyncEnabled: settingsResult.data?.automatic_sync_enabled !== false,
      aiAnalysisEnabled: settingsResult.data?.ai_analysis_enabled === true,
      aiDataScope: 'aggregates_only',
      aiConsentAt: settingsResult.data?.ai_consent_at || null,
    },
  };
}
