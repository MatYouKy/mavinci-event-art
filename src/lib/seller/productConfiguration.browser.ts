import { supabase } from '@/lib/supabase/browser';

export async function sellerConfigurationRequest<T>(productId: string, brandId: string, options: { partnerId?: string; method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> {
  const session = await supabase.auth.getSession();
  if (!session.data.session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  const query = new URLSearchParams({ brand: brandId });
  if (options.partnerId) query.set('partner', options.partnerId);
  const response = await fetch(`/bridge/seller/catalog/${encodeURIComponent(productId)}/configuration?${query}`, {
    method: options.method || 'GET', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + session.data.session.access_token, 'Content-Type': 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać konfiguracji produktu.');
  return data as T;
}
