import type { NextRequest } from 'next/server';

const DEFAULT_PRODUCTION_ORIGIN = 'https://mavinci.pl';

export function getMarketingPublicOrigin(request: NextRequest) {
  const configuredOrigin =
    process.env.MARKETING_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_MARKETING_BASE_URL ||
    process.env.NEXT_PUBLIC_FRONTEND_URL;
  const candidate =
    configuredOrigin ||
    (process.env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_ORIGIN : request.nextUrl.origin);

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Nieobsługiwany protokół publicznego adresu aplikacji.');
    }
    return url.origin;
  } catch {
    return process.env.NODE_ENV === 'production'
      ? DEFAULT_PRODUCTION_ORIGIN
      : request.nextUrl.origin;
  }
}

export function getMarketingPublicUrl(request: NextRequest, pathname: string) {
  return new URL(pathname, `${getMarketingPublicOrigin(request)}/`);
}
