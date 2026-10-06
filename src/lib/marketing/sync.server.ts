import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { decryptMarketingCredentials, encryptMarketingCredentials } from './crypto.server';
import {
  getMetaGraphVersion,
  getGoogleAdsVersion,
  googleAdsHeaders,
  normaliseGoogleCustomerId,
  normaliseMetaAdAccountId,
  readJsonResponse,
} from './providers.server';

type IntegrationRow = {
  id: string;
  company_id: string;
  provider: 'meta' | 'google';
  settings: Record<string, any>;
  credentials_encrypted: string | null;
};

type GoogleCredentials = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  token_type?: string;
};

type MetaCredentials = {
  user_access_token: string;
  page_access_tokens?: Record<string, string>;
  expires_at?: string | null;
};

const numberValue = (value: unknown) => Number(value || 0);
const moneyFromMicros = (value: unknown) => numberValue(value) / 1_000_000;

function dateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function metaActionValue(actions: any[], accepted: string[]) {
  return (actions || []).reduce((sum, action) => {
    const type = String(action?.action_type || '');
    return accepted.some((needle) => type.includes(needle)) ? sum + numberValue(action?.value) : sum;
  }, 0);
}

async function markIntegration(
  integrationId: string,
  values: Record<string, unknown>,
) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('marketing_integrations')
    .update(values)
    .eq('id', integrationId);
  if (error) throw error;
}

async function refreshGoogleCredentials(integration: IntegrationRow, credentials: GoogleCredentials) {
  const expiresAt = credentials.expires_at ? new Date(credentials.expires_at).getTime() : 0;
  if (credentials.access_token && expiresAt > Date.now() + 5 * 60 * 1000) return credentials;
  if (!credentials.refresh_token) throw new Error('Autoryzacja Google wygasła. Połącz konto ponownie.');

  const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_MARKETING_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Brak konfiguracji OAuth Google.');

  const tokenData = await readJsonResponse(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: credentials.refresh_token,
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    }),
    'Odświeżenie autoryzacji Google',
  );
  const nextCredentials: GoogleCredentials = {
    ...credentials,
    access_token: tokenData.access_token,
    expires_at: new Date(Date.now() + Number(tokenData.expires_in || 3600) * 1000).toISOString(),
    token_type: tokenData.token_type || 'Bearer',
  };
  await markIntegration(integration.id, {
    credentials_encrypted: encryptMarketingCredentials(nextCredentials),
    token_expires_at: nextCredentials.expires_at,
  });
  return nextCredentials;
}

async function syncSearchConsole(
  integration: IntegrationRow,
  credentials: GoogleCredentials,
) {
  const siteUrl = String(integration.settings.search_console_site_url || '').trim();
  if (!siteUrl) return { rows: 0, skipped: true };
  const { start, end } = dateRange();
  const data = await readJsonResponse(
    await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: start,
          endDate: end,
          dimensions: ['date'],
          type: 'web',
          dataState: 'all',
          rowLimit: 25000,
        }),
        cache: 'no-store',
      },
    ),
    'Google Search Console',
  );
  const rows = (data.rows || []).map((row: any) => ({
    company_id: integration.company_id,
    integration_id: integration.id,
    source: 'google_search_console',
    metric_date: row.keys?.[0],
    external_campaign_id: '',
    currency: 'PLN',
    organic_clicks: numberValue(row.clicks),
    organic_impressions: numberValue(row.impressions),
    average_position: numberValue(row.position),
    dimensions: { ctr: numberValue(row.ctr), site_url: siteUrl },
    synced_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('marketing_metrics_daily')
      .upsert(rows, { onConflict: 'company_id,source,metric_date,external_campaign_id' });
    if (error) throw error;
  }
  return { rows: rows.length, skipped: false };
}

async function syncGoogleAds(integration: IntegrationRow, credentials: GoogleCredentials) {
  const customerId = normaliseGoogleCustomerId(
    String(integration.settings.google_ads_customer_id || ''),
  );
  if (!customerId) return { rows: 0, campaigns: 0, skipped: true };
  if (!/^\d{10}$/.test(customerId)) throw new Error('Numer konta reklamowego Google Ads musi mieć 10 cyfr.');
  const headers = googleAdsHeaders(credentials.access_token, String(integration.settings.google_ads_login_customer_id || ''));
  const search = async (query: string) => {
    const response = await fetch(
      `https://googleads.googleapis.com/${getGoogleAdsVersion()}/customers/${customerId}/googleAds:searchStream`,
      { method: 'POST', headers, body: JSON.stringify({ query }), cache: 'no-store' },
    );
    const batches = await readJsonResponse(response, 'Google Ads');
    return (Array.isArray(batches) ? batches : [batches]).flatMap((batch: any) => batch.results || []);
  };
  const accountRows = await search('SELECT customer.id, customer.manager, customer.currency_code FROM customer LIMIT 1');
  const account = accountRows[0]?.customer;
  if (!account) throw new Error('Google Ads nie zwrócił danych wybranego konta. Sprawdź przypisanie kont.');
  if (account.manager) {
    throw new Error('Wybrano konto menedżera zamiast konta reklamowego. W polu klienta wybierz konto, na którym powstają kampanie; numer menedżera wpisz w osobnym polu MCC.');
  }
  const { start, end } = dateRange();
  // A date-segmented report omits campaigns without activity. Fetch the catalog separately.
  const catalog = await search(`SELECT campaign.id, campaign.name, campaign.status,
    campaign.advertising_channel_type, campaign.start_date, campaign.end_date,
    campaign_budget.amount_micros, campaign_budget.total_amount_micros, campaign_budget.period FROM campaign`);
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `;
  const results = await search(query);
  const currency = String(account.currencyCode || integration.settings.currency || 'PLN');
  const metricRows = results.map((row: any) => ({
    company_id: integration.company_id,
    integration_id: integration.id,
    source: 'google_ads',
    metric_date: row.segments?.date,
    external_campaign_id: String(row.campaign?.id || ''),
    campaign_name: row.campaign?.name || '',
    currency,
    impressions: numberValue(row.metrics?.impressions),
    clicks: numberValue(row.metrics?.clicks),
    spend: moneyFromMicros(row.metrics?.costMicros),
    conversions: numberValue(row.metrics?.conversions),
    conversion_value: numberValue(row.metrics?.conversionsValue),
    dimensions: { channel: row.campaign?.advertisingChannelType || null },
    synced_at: new Date().toISOString(),
  }));

  const campaigns = new Map<string, any>();
  for (const row of [...catalog, ...results]) {
    const id = String(row.campaign?.id || '');
    if (!id) continue;
    const current = campaigns.get(id) || {
      company_id: integration.company_id,
      integration_id: integration.id,
      provider: 'google_ads',
      external_campaign_id: id,
      name: row.campaign?.name || id,
      status: row.campaign?.status || 'UNKNOWN',
      objective: row.campaign?.advertisingChannelType || null,
      budget_daily: row.campaignBudget?.period === 'CUSTOM_PERIOD' ? null : moneyFromMicros(row.campaignBudget?.amountMicros),
      budget_lifetime: row.campaignBudget?.period === 'CUSTOM_PERIOD' ? moneyFromMicros(row.campaignBudget?.totalAmountMicros) : null,
      currency,
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      conversion_value: 0,
      start_date: row.campaign?.startDate || null,
      end_date: row.campaign?.endDate || null,
      metadata: { customer_id: customerId, report_start: start, report_end: end },
      synced_at: new Date().toISOString(),
    };
    current.impressions += numberValue(row.metrics?.impressions);
    current.clicks += numberValue(row.metrics?.clicks);
    current.spend += moneyFromMicros(row.metrics?.costMicros);
    current.conversions += numberValue(row.metrics?.conversions);
    current.conversion_value += numberValue(row.metrics?.conversionsValue);
    campaigns.set(id, current);
  }

  const admin = createSupabaseAdminClient();
  if (metricRows.length) {
    const { error } = await admin
      .from('marketing_metrics_daily')
      .upsert(metricRows, { onConflict: 'company_id,source,metric_date,external_campaign_id' });
    if (error) throw error;
  }
  if (campaigns.size) {
    const { error } = await admin
      .from('marketing_campaigns')
      .upsert(Array.from(campaigns.values()), {
        onConflict: 'company_id,provider,external_campaign_id',
      });
    if (error) throw error;
  }
  return { rows: metricRows.length, campaigns: campaigns.size, skipped: false };
}

async function syncMeta(integration: IntegrationRow, credentials: MetaCredentials) {
  const graphVersion = getMetaGraphVersion();
  const { start, end } = dateRange();
  const adAccountId = normaliseMetaAdAccountId(String(integration.settings.ad_account_id || ''));
  const pageId = String(integration.settings.page_id || '').trim();
  const currency = String(integration.settings.currency || 'PLN');
  const admin = createSupabaseAdminClient();
  let metricCount = 0;
  let campaignCount = 0;
  let messageCount = 0;

  if (adAccountId) {
    const insightsUrl = new URL(
      `https://graph.facebook.com/${graphVersion}/${adAccountId}/insights`,
    );
    insightsUrl.searchParams.set(
      'fields',
      'campaign_id,campaign_name,impressions,clicks,spend,reach,actions,action_values,date_start,date_stop',
    );
    insightsUrl.searchParams.set('level', 'campaign');
    insightsUrl.searchParams.set('time_increment', '1');
    insightsUrl.searchParams.set('time_range', JSON.stringify({ since: start, until: end }));
    insightsUrl.searchParams.set('limit', '5000');
    insightsUrl.searchParams.set('access_token', credentials.user_access_token);
    const insights = await readJsonResponse(await fetch(insightsUrl, { cache: 'no-store' }), 'Meta Ads');
    const metricRows = (insights.data || []).map((row: any) => ({
      company_id: integration.company_id,
      integration_id: integration.id,
      source: 'meta_ads',
      metric_date: row.date_start,
      external_campaign_id: String(row.campaign_id || ''),
      campaign_name: row.campaign_name || '',
      currency,
      impressions: numberValue(row.impressions),
      clicks: numberValue(row.clicks),
      spend: numberValue(row.spend),
      conversions: metaActionValue(row.actions, ['purchase', 'lead', 'conversion']),
      conversion_value: metaActionValue(row.action_values, ['purchase', 'conversion']),
      reach: numberValue(row.reach),
      synced_at: new Date().toISOString(),
    }));
    if (metricRows.length) {
      const { error } = await admin
        .from('marketing_metrics_daily')
        .upsert(metricRows, { onConflict: 'company_id,source,metric_date,external_campaign_id' });
      if (error) throw error;
      metricCount += metricRows.length;
    }

    const campaignsUrl = new URL(
      `https://graph.facebook.com/${graphVersion}/${adAccountId}/campaigns`,
    );
    campaignsUrl.searchParams.set(
      'fields',
      'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    );
    campaignsUrl.searchParams.set('limit', '500');
    campaignsUrl.searchParams.set('access_token', credentials.user_access_token);
    const campaignData = await readJsonResponse(
      await fetch(campaignsUrl, { cache: 'no-store' }),
      'Kampanie Meta',
    );
    const totals = new Map<string, any>();
    for (const metric of metricRows) {
      const current = totals.get(metric.external_campaign_id) || {
        impressions: 0,
        clicks: 0,
        spend: 0,
        conversions: 0,
        conversion_value: 0,
      };
      current.impressions += metric.impressions;
      current.clicks += metric.clicks;
      current.spend += metric.spend;
      current.conversions += metric.conversions;
      current.conversion_value += metric.conversion_value;
      totals.set(metric.external_campaign_id, current);
    }
    const campaignRows = (campaignData.data || []).map((campaign: any) => ({
      company_id: integration.company_id,
      integration_id: integration.id,
      provider: 'meta_ads',
      external_campaign_id: String(campaign.id),
      name: campaign.name || campaign.id,
      status: campaign.effective_status || campaign.status || 'UNKNOWN',
      objective: campaign.objective || null,
      budget_daily: campaign.daily_budget ? numberValue(campaign.daily_budget) / 100 : null,
      budget_lifetime: campaign.lifetime_budget
        ? numberValue(campaign.lifetime_budget) / 100
        : null,
      currency,
      ...(totals.get(String(campaign.id)) || {}),
      start_date: campaign.start_time?.slice(0, 10) || null,
      end_date: campaign.stop_time?.slice(0, 10) || null,
      metadata: { configured_status: campaign.status || null },
      synced_at: new Date().toISOString(),
    }));
    if (campaignRows.length) {
      const { error } = await admin.from('marketing_campaigns').upsert(campaignRows, {
        onConflict: 'company_id,provider,external_campaign_id',
      });
      if (error) throw error;
      campaignCount = campaignRows.length;
    }
  }

  if (pageId) {
    const pageToken = credentials.page_access_tokens?.[pageId] || credentials.user_access_token;
    const pageInsightsUrl = new URL(
      `https://graph.facebook.com/${graphVersion}/${pageId}/insights`,
    );
    pageInsightsUrl.searchParams.set(
      'metric',
      'page_impressions,page_post_engagements,page_messages_new_conversations_unique',
    );
    pageInsightsUrl.searchParams.set('period', 'day');
    pageInsightsUrl.searchParams.set('since', start);
    pageInsightsUrl.searchParams.set('until', end);
    pageInsightsUrl.searchParams.set('access_token', pageToken);
    try {
      const insights = await readJsonResponse(
        await fetch(pageInsightsUrl, { cache: 'no-store' }),
        'Statystyki strony Facebook',
      );
      const rowsByDate = new Map<string, any>();
      for (const metric of insights.data || []) {
        for (const value of metric.values || []) {
          const date = String(value.end_time || '').slice(0, 10);
          if (!date) continue;
          const row = rowsByDate.get(date) || {
            company_id: integration.company_id,
            integration_id: integration.id,
            source: 'meta_page',
            metric_date: date,
            external_campaign_id: '',
            currency,
            impressions: 0,
            engagement: 0,
            messages: 0,
            dimensions: { page_id: pageId },
            synced_at: new Date().toISOString(),
          };
          if (metric.name === 'page_impressions') row.impressions = numberValue(value.value);
          if (metric.name === 'page_post_engagements') row.engagement = numberValue(value.value);
          if (metric.name === 'page_messages_new_conversations_unique') {
            row.messages = numberValue(value.value);
          }
          rowsByDate.set(date, row);
        }
      }
      if (rowsByDate.size) {
        const { error } = await admin
          .from('marketing_metrics_daily')
          .upsert(Array.from(rowsByDate.values()), {
            onConflict: 'company_id,source,metric_date,external_campaign_id',
          });
        if (error) throw error;
        metricCount += rowsByDate.size;
      }
    } catch (error) {
      console.warn('[marketing sync] Meta page insights unavailable', error);
    }

    const conversationsUrl = new URL(
      `https://graph.facebook.com/${graphVersion}/${pageId}/conversations`,
    );
    conversationsUrl.searchParams.set(
      'fields',
      'id,updated_time,participants,messages.limit(10){id,message,from,created_time}',
    );
    conversationsUrl.searchParams.set('limit', '50');
    conversationsUrl.searchParams.set('access_token', pageToken);
    try {
      const conversations = await readJsonResponse(
        await fetch(conversationsUrl, { cache: 'no-store' }),
        'Wiadomości Facebook',
      );
      const messages = (conversations.data || []).flatMap((thread: any) =>
        (thread.messages?.data || [])
          .filter((message: any) => message.from?.id !== pageId)
          .map((message: any) => ({
            company_id: integration.company_id,
            integration_id: integration.id,
            provider: 'meta',
            external_thread_id: thread.id,
            external_message_id: message.id,
            sender_name: message.from?.name || null,
            sender_external_id: message.from?.id || null,
            message_preview: String(message.message || '').slice(0, 500),
            received_at: message.created_time || thread.updated_time || new Date().toISOString(),
            metadata: { source: 'sync' },
          })),
      );
      if (messages.length) {
        const { data, error } = await admin
          .from('marketing_messages')
          .upsert(messages, { onConflict: 'integration_id,external_message_id', ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        messageCount = data?.length || 0;
      }
    } catch (error) {
      console.warn('[marketing sync] Meta messages unavailable', error);
    }
  }

  return { rows: metricCount, campaigns: campaignCount, messages: messageCount };
}

export async function syncMarketingIntegration(integration: IntegrationRow) {
  if (!integration.credentials_encrypted) throw new Error('Integracja nie jest autoryzowana.');
  await markIntegration(integration.id, { status: 'syncing', last_error: null });
  try {
    let result: Record<string, unknown>;
    if (integration.provider === 'google') {
      const stored = decryptMarketingCredentials<GoogleCredentials>(
        integration.credentials_encrypted,
      );
      const credentials = await refreshGoogleCredentials(integration, stored);
      const sources = await Promise.allSettled([
        syncSearchConsole(integration, credentials),
        syncGoogleAds(integration, credentials),
      ]);
      const labels = ['Google Search Console', 'Google Ads'];
      const outcomes = sources.map((source, index) => source.status === 'fulfilled'
        ? { ok: true, ...source.value }
        : { ok: false, error: `${labels[index]}: ${source.reason?.message || 'Błąd synchronizacji'}` });
      result = { searchConsole: outcomes[0], googleAds: outcomes[1] };
      const errors = outcomes.filter((source) => !source.ok).map((source) => 'error' in source ? source.error : '').join('; ');
      if (errors) {
        // Wait for both sources to finish before reporting a partial failure.
        await markIntegration(integration.id, { status: 'error', last_error: errors.slice(0, 1000) });
        return { integrationId: integration.id, provider: integration.provider, ok: false, error: errors, result };
      }
    } else {
      const credentials = decryptMarketingCredentials<MetaCredentials>(
        integration.credentials_encrypted,
      );
      result = await syncMeta(integration, credentials);
    }
    await markIntegration(integration.id, {
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      last_error: null,
    });
    return { integrationId: integration.id, provider: integration.provider, ok: true, result };
  } catch (error: any) {
    await markIntegration(integration.id, {
      status: 'error',
      last_error: String(error?.message || 'Błąd synchronizacji').slice(0, 1000),
    });
    return {
      integrationId: integration.id,
      provider: integration.provider,
      ok: false,
      error: error?.message || 'Błąd synchronizacji',
    };
  }
}

export async function updateExternalCampaignStatus(
  integration: IntegrationRow,
  campaign: { provider: 'meta_ads' | 'google_ads'; external_campaign_id: string },
  nextStatus: 'ACTIVE' | 'PAUSED',
) {
  if (!integration.credentials_encrypted) throw new Error('Integracja nie jest autoryzowana.');
  if (campaign.provider === 'meta_ads') {
    const credentials = decryptMarketingCredentials<MetaCredentials>(
      integration.credentials_encrypted,
    );
    const url = new URL(
      `https://graph.facebook.com/${getMetaGraphVersion()}/${campaign.external_campaign_id}`,
    );
    url.searchParams.set('access_token', credentials.user_access_token);
    await readJsonResponse(
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: nextStatus }),
      }),
      'Zmiana statusu kampanii Meta',
    );
  } else {
    const stored = decryptMarketingCredentials<GoogleCredentials>(
      integration.credentials_encrypted,
    );
    const credentials = await refreshGoogleCredentials(integration, stored);
    const customerId = normaliseGoogleCustomerId(
      String(integration.settings.google_ads_customer_id || ''),
    );
    if (!/^\d{10}$/.test(customerId)) throw new Error('Brak poprawnego numeru konta reklamowego Google Ads.');
    const headers = googleAdsHeaders(credentials.access_token, String(integration.settings.google_ads_login_customer_id || ''));
    await readJsonResponse(
      await fetch(`https://googleads.googleapis.com/${getGoogleAdsVersion()}/customers/${customerId}/campaigns:mutate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operations: [
            {
              update: {
                resourceName: `customers/${customerId}/campaigns/${campaign.external_campaign_id}`,
                status: nextStatus === 'ACTIVE' ? 'ENABLED' : 'PAUSED',
              },
              updateMask: 'status',
            },
          ],
        }),
        cache: 'no-store',
      }),
      'Zmiana statusu kampanii Google Ads',
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('marketing_campaigns')
    .update({ status: nextStatus === 'ACTIVE' ? 'ACTIVE' : 'PAUSED' })
    .eq('company_id', integration.company_id)
    .eq('provider', campaign.provider)
    .eq('external_campaign_id', campaign.external_campaign_id);
  if (error) throw error;
}
