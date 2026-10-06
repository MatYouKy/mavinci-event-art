import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import type { MarketingProvider } from '@/lib/marketing/types';
import { decryptMarketingCredentials } from '@/lib/marketing/crypto.server';
import { getMetaGraphVersion, normaliseGoogleCustomerId, readJsonResponse } from '@/lib/marketing/providers.server';

const PROVIDERS = new Set<MarketingProvider>(['meta', 'google']);
const ALLOWED_SETTINGS = new Set([
  'page_id',
  'page_name',
  'ad_account_id',
  'ad_account_name',
  'search_console_site_url',
  'google_ads_customer_id',
  'google_ads_login_customer_id',
  'currency',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: { provider: string } },
) {
  try {
    const provider = params.provider as MarketingProvider;
    if (!PROVIDERS.has(provider)) {
      return NextResponse.json({ error: 'Nieobsługiwany dostawca.' }, { status: 404 });
    }

    const access = await getMarketingAccess('manage');
    if (!access.allowed || !access.employee) {
      return NextResponse.json({ error: 'Brak uprawnień do konfiguracji integracji.' }, { status: 403 });
    }

    const body = await request.json();
    const companyId = String(body?.companyId || '');
    if (!companyId || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowa lub niedostępna marka.' }, { status: 400 });
    }

    const settings = Object.fromEntries(
      Object.entries(body?.settings || {})
        .filter(([key]) => ALLOWED_SETTINGS.has(key))
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
    );
    if (provider === 'google') {
      for (const key of ['google_ads_customer_id', 'google_ads_login_customer_id']) {
        if (!(key in settings)) continue;
        const value = normaliseGoogleCustomerId(String(settings[key] || ''));
        if (value && !/^\d{10}$/.test(value)) {
          return NextResponse.json({ error: 'Numer konta Google Ads musi mieć 10 cyfr.' }, { status: 400 });
        }
        settings[key] = value;
      }
      if (settings.google_ads_customer_id && settings.google_ads_customer_id === settings.google_ads_login_customer_id) {
        return NextResponse.json({ error: 'Konto reklamowe i konto menedżera muszą mieć różne numery. Przy bezpośrednim dostępie pozostaw pole menedżera puste.' }, { status: 400 });
      }
    }
    const admin = createSupabaseAdminClient();
    const { data: current, error: currentError } = await admin
      .from('marketing_integrations')
      .select('id, settings, credentials_encrypted, status')
      .eq('company_id', companyId)
      .eq('provider', provider)
      .maybeSingle();
    if (currentError) throw currentError;

    const payload = {
      company_id: companyId,
      provider,
      settings: { ...(current?.settings || {}), ...settings },
      display_name: body?.displayName?.trim() || null,
      external_account_id:
        provider === 'meta'
          ? String(settings.page_id || settings.ad_account_id || '') || null
          : String(settings.google_ads_customer_id || settings.search_console_site_url || '') || null,
      status: current?.credentials_encrypted ? current.status : 'not_connected',
      created_by: access.employee.id,
    };
    const { data, error } = await admin
      .from('marketing_integrations')
      .upsert(payload, { onConflict: 'company_id,provider' })
      .select(
        'id, company_id, provider, status, display_name, external_account_id, settings, scopes, token_expires_at, last_synced_at, last_error, updated_at',
      )
      .single();
    if (error) throw error;

    if (provider === 'meta' && current?.credentials_encrypted && settings.page_id) {
      try {
        const credentials = decryptMarketingCredentials<{
          user_access_token: string;
          page_access_tokens?: Record<string, string>;
        }>(current.credentials_encrypted);
        const pageId = String(settings.page_id);
        const pageToken = credentials.page_access_tokens?.[pageId] || credentials.user_access_token;
        const subscribeUrl = new URL(
          `https://graph.facebook.com/${getMetaGraphVersion()}/${pageId}/subscribed_apps`,
        );
        subscribeUrl.searchParams.set('access_token', pageToken);
        await readJsonResponse(
          await fetch(subscribeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ subscribed_fields: 'messages' }),
          }),
          'Subskrypcja wiadomości strony Meta',
        );
      } catch (subscriptionError) {
        console.warn('[marketing integration] Meta webhook subscription unavailable', subscriptionError);
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[marketing integration config]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zapisać konfiguracji integracji.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { provider: string } },
) {
  try {
    const provider = params.provider as MarketingProvider;
    if (!PROVIDERS.has(provider)) {
      return NextResponse.json({ error: 'Nieobsługiwany dostawca.' }, { status: 404 });
    }
    const access = await getMarketingAccess('manage');
    if (!access.allowed) {
      return NextResponse.json({ error: 'Brak uprawnień do odłączenia integracji.' }, { status: 403 });
    }
    const companyId = request.nextUrl.searchParams.get('companyId') || '';
    if (!companyId || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowa lub niedostępna marka.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('marketing_integrations')
      .update({
        status: 'not_connected',
        credentials_encrypted: null,
        token_expires_at: null,
        last_error: null,
      })
      .eq('company_id', companyId)
      .eq('provider', provider);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[marketing integration disconnect]', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się odłączyć integracji.' },
      { status: 500 },
    );
  }
}
