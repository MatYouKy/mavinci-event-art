export type MarketingProvider = 'meta' | 'google';

export type MarketingIntegrationStatus =
  | 'not_connected'
  | 'connected'
  | 'needs_attention'
  | 'syncing'
  | 'error';

export interface MarketingCompany {
  id: string;
  name: string;
  legal_name: string;
  logo_url?: string | null;
  website?: string | null;
  is_default: boolean;
  is_active: boolean;
}

export interface MarketingIntegrationDTO {
  id: string;
  company_id: string;
  provider: MarketingProvider;
  status: MarketingIntegrationStatus;
  display_name?: string | null;
  external_account_id?: string | null;
  settings: Record<string, unknown>;
  scopes: string[];
  token_expires_at?: string | null;
  last_synced_at?: string | null;
  last_error?: string | null;
  updated_at: string;
}

export interface MarketingMetricTotals {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  reach: number;
  engagement: number;
  messages: number;
  organicClicks: number;
  organicImpressions: number;
  averagePosition: number;
}

export interface MarketingDailyMetric extends MarketingMetricTotals {
  id: string;
  company_id: string;
  source: 'meta_ads' | 'meta_page' | 'google_ads' | 'google_search_console';
  metric_date: string;
  external_campaign_id: string;
  campaign_name?: string | null;
  currency: string;
}

export interface MarketingCampaignDTO {
  id: string;
  provider: 'meta_ads' | 'google_ads';
  external_campaign_id: string;
  name: string;
  status: string;
  objective?: string | null;
  budget_daily?: number | null;
  budget_lifetime?: number | null;
  currency: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversion_value: number;
  synced_at: string;
}

export interface MarketingMessageDTO {
  id: string;
  provider: 'meta';
  sender_name?: string | null;
  sender_external_id?: string | null;
  message_preview: string;
  received_at: string;
  is_read: boolean;
  external_thread_id?: string | null;
}

export interface MarketingAIInsightDTO {
  id: string;
  summary: string;
  recommendations: Array<{
    title: string;
    rationale: string;
    priority: 'high' | 'medium' | 'low';
    channel?: string;
  }>;
  risks: string[];
  opportunities: string[];
  model?: string | null;
  created_at: string;
}

export interface MarketingOverviewDTO {
  companies: MarketingCompany[];
  selectedCompanyId: string | null;
  integrations: MarketingIntegrationDTO[];
  metrics: MarketingDailyMetric[];
  totals: MarketingMetricTotals;
  campaigns: MarketingCampaignDTO[];
  messages: MarketingMessageDTO[];
  unreadMessages: number;
  latestInsight: MarketingAIInsightDTO | null;
  settings: {
    automaticSyncEnabled: boolean;
    aiAnalysisEnabled: boolean;
    aiDataScope: 'aggregates_only';
    aiConsentAt?: string | null;
  };
}
