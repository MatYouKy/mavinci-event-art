import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { GOOGLE_SCOPES, getMetaGraphVersion } from '@/lib/marketing/providers.server';
import { getMarketingPublicUrl } from '@/lib/marketing/public-url.server';
import type { MarketingProvider } from '@/lib/marketing/types';

const COOKIE_NAME = 'marketing_oauth_state';

export async function GET(
  request: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider = params.provider as MarketingProvider;
  const companyId = request.nextUrl.searchParams.get('companyId') || '';
  const access = await getMarketingAccess('manage');

  if (!access.allowed || !companyId || !canAccessMarketingCompany(access, companyId)) {
    return NextResponse.redirect(
      getMarketingPublicUrl(request, '/crm/page?tab=marketing&oauth=forbidden'),
    );
  }

  if (!process.env.MARKETING_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.redirect(
      getMarketingPublicUrl(
        request,
        `/crm/settings/my-companies/${companyId}/marketing?oauth=security_not_configured`,
      ),
    );
  }

  const statePayload = {
    provider,
    companyId,
    nonce: randomBytes(24).toString('base64url'),
    createdAt: Date.now(),
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
  const redirectUri = getMarketingPublicUrl(
    request,
    `/bridge/marketing/oauth/${provider}/callback`,
  ).toString();
  let authorizationUrl: URL;

  if (provider === 'meta') {
    const clientId = process.env.META_APP_ID;
    const loginConfigId = process.env.META_LOGIN_CONFIG_ID;
    if (!clientId || !loginConfigId) {
      return NextResponse.redirect(
        getMarketingPublicUrl(
          request,
          `/crm/settings/my-companies/${companyId}/marketing?oauth=meta_not_configured`,
        ),
      );
    }
    authorizationUrl = new URL(`https://www.facebook.com/${getMetaGraphVersion()}/dialog/oauth`);
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('override_default_response_type', 'true');
    authorizationUrl.searchParams.set('config_id', loginConfigId);
  } else if (provider === 'google') {
    const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_MARKETING_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        getMarketingPublicUrl(
          request,
          `/crm/settings/my-companies/${companyId}/marketing?oauth=google_not_configured`,
        ),
      );
    }
    authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizationUrl.searchParams.set('client_id', clientId);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('access_type', 'offline');
    authorizationUrl.searchParams.set('prompt', 'consent select_account');
    authorizationUrl.searchParams.set('include_granted_scopes', 'true');
  } else {
    return NextResponse.json({ error: 'Nieobsługiwany dostawca.' }, { status: 404 });
  }

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/bridge/marketing/oauth',
    maxAge: 10 * 60,
  });
  return response;
}
