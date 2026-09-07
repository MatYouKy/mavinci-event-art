import { NextResponse } from 'next/server';
import { getMarketingAccess } from '@/lib/marketing/auth.server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await getMarketingAccess('manage');
  if (!access.allowed) {
    return NextResponse.json({ error: 'Brak uprawnień do konfiguracji integracji.' }, { status: 403 });
  }

  const metaMissing = [
    !process.env.META_APP_ID && 'META_APP_ID',
    !process.env.META_APP_SECRET && 'META_APP_SECRET',
    !process.env.META_LOGIN_CONFIG_ID && 'META_LOGIN_CONFIG_ID',
  ].filter(Boolean) as string[];
  const googleMissing = [
    !process.env.GOOGLE_MARKETING_CLIENT_ID && 'GOOGLE_MARKETING_CLIENT_ID',
    !process.env.GOOGLE_MARKETING_CLIENT_SECRET && 'GOOGLE_MARKETING_CLIENT_SECRET',
  ].filter(Boolean) as string[];

  return NextResponse.json({
    security: {
      tokenEncryptionConfigured: Boolean(process.env.MARKETING_TOKEN_ENCRYPTION_KEY),
      missing: process.env.MARKETING_TOKEN_ENCRYPTION_KEY
        ? []
        : ['MARKETING_TOKEN_ENCRYPTION_KEY'],
    },
    meta: {
      oauthConfigured: metaMissing.length === 0,
      webhookConfigured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      missing: [
        ...metaMissing,
        ...(!process.env.META_WEBHOOK_VERIFY_TOKEN ? ['META_WEBHOOK_VERIFY_TOKEN'] : []),
      ],
    },
    google: {
      oauthConfigured: googleMissing.length === 0,
      adsConfigured: Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN),
      missing: [
        ...googleMissing,
        ...(!process.env.GOOGLE_ADS_DEVELOPER_TOKEN ? ['GOOGLE_ADS_DEVELOPER_TOKEN'] : []),
      ],
    },
  });
}
