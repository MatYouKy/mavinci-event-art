import 'server-only';

import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import { getMarketingPublicOrigin } from './public-url.server';

export const MARKETING_OAUTH_MAX_AGE_SECONDS = 20 * 60;
export const LEGACY_MARKETING_OAUTH_COOKIE = 'marketing_oauth_state';

// Each attempt has its own cookie: Google, Meta and separate tabs cannot overwrite it.
export function marketingOAuthCookieName(state: string) {
  return `marketing_oauth_${createHash('sha256').update(state).digest('hex').slice(0, 32)}`;
}

export function marketingOAuthCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    secure: new URL(getMarketingPublicOrigin(request)).protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/bridge/marketing/oauth',
    maxAge: MARKETING_OAUTH_MAX_AGE_SECONDS,
  };
}

// Next can see an internal origin behind a reverse proxy. Only compare forwarded
// headers with the configured public origin; never use them as a redirect target.
export function isMarketingPublicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '');
  try {
    return new URL(`${protocol}://${host}`).origin === getMarketingPublicOrigin(request);
  } catch {
    return false;
  }
}
