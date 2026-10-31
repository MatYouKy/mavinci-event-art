import 'server-only';
import { generateOfferPdf } from '@/lib/offer-pdf/service';
import type { SupabaseClient } from '@supabase/supabase-js';

// Private seller rendering runs locally in the shared Node bridge renderer.
export async function renderSellerOfferPdf(_admin: SupabaseClient, offer: { id: string }, sourceKey: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('Generator PDF nie jest skonfigurowany. Skontaktuj się z administratorem.');
  const headers = { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey };
  const response = await generateOfferPdf(new Request('http://offer-pdf.internal/render', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId: offer.id, outputMode: 'seller_binary', expectedSourceKey: sourceKey }),
  }));
  if (!response.ok) {
    const details = await response.text();
    console.error('Shared seller PDF renderer:', response.status, details);
    let fontError: { code?: string; error?: string } | null = null;
    try { fontError = JSON.parse(details); } catch { /* Non-JSON gateway error. */ }
    if (fontError?.code === 'SELLER_EVENT_DATE_REQUIRED') {
      throw Object.assign(new Error('Uzupełnij datę wydarzenia i zapisz ofertę przed wygenerowaniem PDF.'), { code: 'SELLER_EVENT_DATE_REQUIRED', status: 422 });
    }
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
