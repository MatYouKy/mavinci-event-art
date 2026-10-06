import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// A thin adapter: layout, typography and all PDF pages live in generate-offer-pdf.
export async function renderSellerOfferPdf(_admin: SupabaseClient, offer: { id: string }, sourceKey: string) {
  const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1/generate-offer-pdf';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Generator PDF nie jest skonfigurowany. Skontaktuj się z administratorem.');
  const headers = { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey };
  // Refuse an old deployment before POST: its legacy route could write a public CRM PDF.
  const capabilities = await fetch(endpoint, {
    method: 'OPTIONS', headers, cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!capabilities.ok || capabilities.headers.get('X-Offer-Renderer') !== 'seller-v1'
      || capabilities.headers.get('X-Offer-Identity') !== 'organization-v1'
      || capabilities.headers.get('X-Offer-Fonts') !== 'catalog-v1') {
    throw new Error('Generator PDF wymaga aktualizacji. Administrator musi wdrożyć funkcję generate-offer-pdf z obsługą brandingu i biblioteki czcionek CRM.');
  }
  const response = await fetch(endpoint, {
    method: 'POST', cache: 'no-store',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId: offer.id, outputMode: 'seller_binary', expectedSourceKey: sourceKey }),
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error('Shared seller PDF renderer:', response.status, details);
    let fontError: { code?: string; error?: string } | null = null;
    try { fontError = JSON.parse(details); } catch { /* Non-JSON gateway error. */ }
    if (fontError?.code === 'SELLER_FONT_ERROR' && typeof fontError.error === 'string') {
      throw new Error(fontError.error.slice(0, 500));
    }
    throw new Error(response.status === 546
      ? 'Generator przekroczył limit zasobów. Skontaktuj się z opiekunem Mavinci.'
      : 'Nie udało się wygenerować PDF. Oferta jest zapisana — ponów generowanie.');
  }
  if (!response.headers.get('Content-Type')?.includes('application/pdf')
      || response.headers.get('X-Offer-Renderer') !== 'seller-v1'
      || response.headers.get('X-Offer-Identity') !== 'organization-v1'
      || response.headers.get('X-Offer-Fonts') !== 'catalog-v1'
      || response.headers.get('X-Offer-Source-Key') !== sourceKey) {
    throw new Error('Generator nie zwrócił aktualnej wersji PDF. Ponów generowanie.');
  }
  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Generator zwrócił nieprawidłowy dokument PDF.');
  return pdf;
}
