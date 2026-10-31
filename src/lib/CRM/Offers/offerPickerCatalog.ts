'use client';
import { supabase } from '@/lib/supabase/browser';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

const TTL = 5 * 60 * 1000;
let owner: string | null = null;
let cached: { expires: number; data: any[] } | null = null;
let pending: Promise<any[]> | null = null;
let revision = 0;
export function invalidateOfferPickerCatalog() { cached = null; pending = null; revision++; }
supabase.auth.onAuthStateChange((_event, session) => {
  if (owner !== (session?.user.id || null)) {
    owner = session?.user.id || null;
    invalidateOfferPickerCatalog();
  }
});

export async function loadOfferPickerCatalog(refresh = false): Promise<any[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  if (owner !== session.user.id) { owner = session.user.id; invalidateOfferPickerCatalog(); }
  if (refresh) invalidateOfferPickerCatalog();
  if (cached && cached.expires > Date.now()) return cached.data;
  if (pending) return pending;
  const version = revision;
  const request = fetchCatalog().then(data => {
    if (version === revision) cached = { data, expires: Date.now() + TTL };
    return data;
  }).finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}
async function fetchCatalog() {
      const { data, error } = await supabase
        .from('offer_products')
        .select(
          `
          *,
          variants:offer_product_variants(id, product_id, name, short_description, description, benefits, price_net, price_gross, offer_image_path, is_recommended, is_active, display_order, quantity_source),
          category:event_categories(name)
        `,
        )
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      const imagePaths = Array.from(new Set<string>((data || [])
        .map((product) => product.pdf_thumbnail_url || product.offer_image_path)
        .filter((path): path is string => Boolean(path))));
      const thumbnailUrls = new Map<string, string>();
      if (imagePaths.length > 0) {
        // Sign in one request; Next Image resizes and compresses before delivery.
        const { data: signedImages, error: imageError } = await supabase.storage
          .from('offer-product-pages')
          .createSignedUrls(imagePaths, 3600);
        if (imageError) console.error('Error preparing product thumbnails:', imageError);
        for (const image of signedImages || []) {
          if (image.path && image.signedUrl && !image.error) {
            thumbnailUrls.set(image.path, image.signedUrl);
          }
        }
      }
      return (data || []).map((product: any) => ({
        ...product,
        thumbnailSrc: thumbnailUrls.get(product.pdf_thumbnail_url || product.offer_image_path) || null,
        variants: [...(product.variants || [])]
          .filter((variant: IProductVariant) => variant.is_active !== false)
          .sort((a: IProductVariant, b: IProductVariant) => a.display_order - b.display_order),
      }));
}
