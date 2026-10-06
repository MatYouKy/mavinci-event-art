export const OPENAI_BILLING_LINKS = {
  overview: 'https://platform.openai.com/settings/organization/billing/overview',
  history: 'https://platform.openai.com/settings/organization/billing/history',
  usage: 'https://platform.openai.com/usage',
  adminKeys: 'https://platform.openai.com/settings/organization/admin-keys',
} as const;

export type OpenAiTokenTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
};

export type OpenAiAmount = { currency: string; value: number };

export type OpenAiUsageReport = {
  status: 'ready' | 'partial' | 'unavailable' | 'not_configured';
  month: string;
  period: { start: string; end: string };
  scope: { type: 'organization' | 'projects'; projectIds: string[] };
  fetchedAt: string | null;
  usage: {
    totals: OpenAiTokenTotals;
    models: Array<OpenAiTokenTotals & { model: string }>;
  } | null;
  costs: { totals: OpenAiAmount[] } | null;
  days: Array<{ date: string; usage: OpenAiTokenTotals | null; costs: OpenAiAmount[] | null }>;
  warnings: string[];
};
