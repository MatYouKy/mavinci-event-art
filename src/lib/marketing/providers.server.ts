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
    // OAuth errors are strings; Google Ads failures can be wrapped in a stream array.
    const payload = Array.isArray(data) ? data.find((item) => item?.error) || {} : data;
    const error = payload?.error;
    const code = typeof error === 'string' ? error : error?.status;
    if (code === 'invalid_grant') {
      throw new Error(`${label}: Google odrzucił zapisane uprawnienie (invalid_grant). W ustawieniach integracji kliknij „Odśwież dostęp” lub „Połącz Google” i zaloguj się ponownie.`);
    }
    const details = (error?.details || []).flatMap((detail: any) => detail.errors || [])
      .map((item: any) => [Object.values(item.errorCode || {}).join(', '), item.message].filter(Boolean).join(': '));
    const message = details.join('; ') || error?.message || payload?.error_description || payload?.message || code || `HTTP ${response.status}`;
    const requestId = response.headers.get('request-id');
    throw new Error(`${label}: ${message}${requestId ? ` (request-id: ${requestId})` : ''}`);

  }
  return data;
}

export function normaliseGoogleCustomerId(value: string) {
  return value.trim().replace(/^customers\//, '').replace(/[-\s]/g, '');
}

export function normaliseMetaAdAccountId(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return '';
  return cleaned.startsWith('act_') ? cleaned : `act_${cleaned}`;
}

export function googleAdsHeaders(accessToken: string, loginCustomerId = '') {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  // API access is managed by the OAuth Google Cloud project since September 2026.
  // Keep the legacy header optional for existing deployments.
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    headers['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  }
  const managerId = normaliseGoogleCustomerId(loginCustomerId);
  if (managerId) {
    if (!/^\d{10}$/.test(managerId)) throw new Error('Numer konta menedżera Google Ads musi mieć 10 cyfr.');
    headers['login-customer-id'] = managerId;
  }
  return headers;
}
