import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { encryptMarketingCredentials } from '@/lib/marketing/crypto.server';
import {
  GOOGLE_SCOPES,
  getGoogleAdsVersion,
  getMetaGraphVersion,
  normaliseGoogleCustomerId,
  readJsonResponse,
} from '@/lib/marketing/providers.server';
import { getMarketingPublicUrl } from '@/lib/marketing/public-url.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import type { MarketingProvider } from '@/lib/marketing/types';

const COOKIE_NAME = 'marketing_oauth_state';

function redirectWithStatus(request: NextRequest, companyId: string, status: string) {
  const pathname = companyId
    ? `/crm/settings/my-companies/${companyId}/marketing`
    : '/crm/settings/my-companies';
  const response = NextResponse.redirect(
    getMarketingPublicUrl(request, `${pathname}?oauth=${encodeURIComponent(status)}`),
  );
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/bridge/marketing/oauth',
    maxAge: 0,
  });
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider = params.provider as MarketingProvider;
  const state = request.nextUrl.searchParams.get('state') || '';
  const code = request.nextUrl.searchParams.get('code') || '';
  const cookieState = request.cookies.get(COOKIE_NAME)?.value || '';
  let companyId = '';

  try {
    if (!state || state !== cookieState || !code) throw new Error('Nieprawidłowy stan autoryzacji.');
    const payload = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    companyId = String(payload.companyId || '');
    if (
      payload.provider !== provider ||
      !companyId ||
      Date.now() - Number(payload.createdAt || 0) > 10 * 60 * 1000
    ) {
      throw new Error('Autoryzacja wygasła.');
    }

    const access = await getMarketingAccess('manage');
    if (!access.allowed || !access.employee || !canAccessMarketingCompany(access, companyId)) {
      return redirectWithStatus(request, companyId, 'forbidden');
    }

    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin
      .from('marketing_integrations')
      .select('settings')
      .eq('company_id', companyId)
      .eq('provider', provider)
      .maybeSingle();
    if (currentError) throw currentError;
    const currentSettings = current?.settings || {};
    const redirectUri = getMarketingPublicUrl(
      request,
      `/bridge/marketing/oauth/${provider}/callback`,
    ).toString();

    let credentials: Record<string, unknown>;
    let settings: Record<string, unknown>;
    let displayName: string | null = null;
    let externalAccountId: string | null = null;
    let tokenExpiresAt: string | null = null;
    let scopes: string[] = [];

    if (provider === 'google') {
      const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_MARKETING_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error('Brak konfiguracji OAuth Google.');

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const tokens = await readJsonResponse(tokenResponse, 'Autoryzacja Google');
      const accessToken = String(tokens.access_token || '');
      if (!accessToken) throw new Error('Google nie zwrócił tokenu dostępu.');

      const [profileResult, sitesResult, customersResult] = await Promise.allSettled([
        fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then((response) => readJsonResponse(response, 'Profil Google')),
        fetch('https://www.googleapis.com/webmasters/v3/sites', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then((response) => readJsonResponse(response, 'Search Console')),
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN
          ? fetch(`https://googleads.googleapis.com/${getGoogleAdsVersion()}/customers:listAccessibleCustomers`, {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
              },
            }).then((response) => readJsonResponse(response, 'Google Ads'))
          : Promise.resolve({ resourceNames: [] }),
      ]);
      const profile = profileResult.status === 'fulfilled' ? profileResult.value : {};
      const sites = sitesResult.status === 'fulfilled' ? sitesResult.value?.siteEntry || [] : [];
      const resourceNames =
        customersResult.status === 'fulfilled' ? customersResult.value?.resourceNames || [] : [];
      const customerIds = resourceNames.map((value: string) => normaliseGoogleCustomerId(value));

      tokenExpiresAt = tokens.expires_in
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
        : null;
      credentials = {
        access_token: accessToken,
        refresh_token: tokens.refresh_token || null,
        expires_at: tokenExpiresAt,
        token_type: tokens.token_type || 'Bearer',
      };
      settings = {
        ...currentSettings,
        google_email: profile.email || null,
        available_search_console_sites: sites,
        accessible_google_ads_customer_ids: customerIds,
        search_console_site_url:
          currentSettings.search_console_site_url || sites[0]?.siteUrl || '',
        google_ads_customer_id:
          currentSettings.google_ads_customer_id || customerIds[0] || '',
      };
      displayName = profile.email || 'Google';
      externalAccountId =
        String(settings.google_ads_customer_id || settings.search_console_site_url || '') || null;
      scopes = String(tokens.scope || GOOGLE_SCOPES.join(' ')).split(' ').filter(Boolean);
    } else if (provider === 'meta') {
      const clientId = process.env.META_APP_ID;
      const clientSecret = process.env.META_APP_SECRET;
      if (!clientId || !clientSecret) throw new Error('Brak konfiguracji OAuth Meta.');
      const graphVersion = getMetaGraphVersion();
      const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
      tokenUrl.searchParams.set('client_id', clientId);
      tokenUrl.searchParams.set('client_secret', clientSecret);
      tokenUrl.searchParams.set('redirect_uri', redirectUri);
      tokenUrl.searchParams.set('code', code);
      const shortToken = await readJsonResponse(
        await fetch(tokenUrl),
        'Autoryzacja Meta',
      );
      let userAccessToken = String(shortToken.access_token || '');
      if (!userAccessToken) throw new Error('Meta nie zwróciła tokenu dostępu.');

      const longTokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
      longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
      longTokenUrl.searchParams.set('client_id', clientId);
      longTokenUrl.searchParams.set('client_secret', clientSecret);
      longTokenUrl.searchParams.set('fb_exchange_token', userAccessToken);
      try {
        const longToken = await readJsonResponse(await fetch(longTokenUrl), 'Token Meta');
        userAccessToken = String(longToken.access_token || userAccessToken);
        if (longToken.expires_in) {
          tokenExpiresAt = new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString();
        }
      } catch (error) {
        console.warn('[marketing oauth] long-lived Meta token unavailable', error);
      }

      const fields = encodeURIComponent('id,name,access_token,category');
      const [profile, pages, adAccounts, permissionResponse] = await Promise.all([
        readJsonResponse(
          await fetch(
            `https://graph.facebook.com/${graphVersion}/me?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`,
          ),
          'Profil Meta',
        ),
        readJsonResponse(
          await fetch(
            `https://graph.facebook.com/${graphVersion}/me/accounts?fields=${fields}&limit=100&access_token=${encodeURIComponent(userAccessToken)}`,
          ),
          'Strony Meta',
        ),
        readJsonResponse(
          await fetch(
            `https://graph.facebook.com/${graphVersion}/me/adaccounts?fields=id,name,account_status,currency&limit=100&access_token=${encodeURIComponent(userAccessToken)}`,
          ),
          'Konta reklamowe Meta',
        ).catch(() => ({ data: [] })),
        readJsonResponse(
          await fetch(
            `https://graph.facebook.com/${graphVersion}/me/permissions?access_token=${encodeURIComponent(userAccessToken)}`,
          ),
          'Uprawnienia Meta',
        ).catch(() => ({ data: [] })),
      ]);
      const availablePages = pages.data || [];
      const availableAdAccounts = adAccounts.data || [];
      const grantedScopes = (permissionResponse.data || [])
        .filter((permission: any) => permission.status === 'granted')
        .map((permission: any) => String(permission.permission || ''))
        .filter(Boolean);
      const selectedPage =
        availablePages.find((page: any) => page.id === currentSettings.page_id) || availablePages[0];
      const selectedAdAccount =
        availableAdAccounts.find((account: any) => account.id === currentSettings.ad_account_id) ||
        availableAdAccounts[0];

      if (
        selectedPage?.id &&
        selectedPage?.access_token &&
        grantedScopes.includes('pages_messaging') &&
        grantedScopes.includes('pages_manage_metadata')
      ) {
        const subscribeUrl = new URL(
          `https://graph.facebook.com/${graphVersion}/${selectedPage.id}/subscribed_apps`,
        );
        subscribeUrl.searchParams.set('access_token', selectedPage.access_token);
        try {
          await readJsonResponse(
            await fetch(subscribeUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ subscribed_fields: 'messages' }),
            }),
            'Subskrypcja wiadomości strony Meta',
          );
        } catch (error) {
          console.warn('[marketing oauth] Meta webhook subscription unavailable', error);
        }
      }

      credentials = {
        user_access_token: userAccessToken,
        page_access_tokens: Object.fromEntries(
          availablePages.map((page: any) => [page.id, page.access_token]),
        ),
        expires_at: tokenExpiresAt,
      };
      settings = {
        ...currentSettings,
        meta_user_id: profile.id || null,
        available_pages: availablePages.map(({ access_token: _token, ...page }: any) => page),
        available_ad_accounts: availableAdAccounts,
        page_id: currentSettings.page_id || selectedPage?.id || '',
        page_name: currentSettings.page_name || selectedPage?.name || '',
        ad_account_id: currentSettings.ad_account_id || selectedAdAccount?.id || '',
        ad_account_name: currentSettings.ad_account_name || selectedAdAccount?.name || '',
        currency: currentSettings.currency || selectedAdAccount?.currency || 'PLN',
      };
      displayName = profile.name || selectedPage?.name || 'Meta';
      externalAccountId = String(settings.page_id || settings.ad_account_id || '') || null;
      scopes = grantedScopes;
    } else {
      throw new Error('Nieobsługiwany dostawca.');
    }

    const { error: saveError } = await admin.from('marketing_integrations').upsert(
      {
        company_id: companyId,
        provider,
        status: 'connected',
        display_name: displayName,
        external_account_id: externalAccountId,
        settings,
        scopes,
        credentials_encrypted: encryptMarketingCredentials(credentials),
        token_expires_at: tokenExpiresAt,
        last_error: null,
        created_by: access.employee.id,
      },
      { onConflict: 'company_id,provider' },
    );
    if (saveError) throw saveError;

    return redirectWithStatus(request, companyId, `${provider}_connected`);
  } catch (error: any) {
    console.error('[marketing oauth callback]', error);
    return redirectWithStatus(
      request,
      companyId,
      `error_${String(error?.message || 'oauth').slice(0, 80)}`,
    );
  }
}
