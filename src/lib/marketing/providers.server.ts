import 'server-only';

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'ads_read',
  'ads_management',
  'business_management',
];

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/adwords',
];

export const getMetaGraphVersion = () => process.env.META_GRAPH_API_VERSION || 'v26.0';
export const getGoogleAdsVersion = () => process.env.GOOGLE_ADS_API_VERSION || 'v25';

export async function readJsonResponse(response: Response, label: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.error?.message || data?.error_description || data?.message || `${label}: HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export function normaliseGoogleCustomerId(value: string) {
  return value.replace(/^customers\//, '').replace(/-/g, '').trim();
}

export function normaliseMetaAdAccountId(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return '';
  return cleaned.startsWith('act_') ? cleaned : `act_${cleaned}`;
}
