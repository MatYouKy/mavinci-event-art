import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const getProductPageData = cache(async (productId: string) => {
  const supabase = createSupabaseServerClient(cookies());

  const [productRes, categoriesRes] = await Promise.all([
    productId && productId !== 'new'
      ? supabase
          .from('offer_products')
          .select(`*, category:event_categories(id, name)`)
          .eq('id', productId)
          .maybeSingle()
      : Promise.resolve({ data: null as any, error: null as any }),

    supabase
      .from('event_categories')
      .select('id, name')
      .eq('is_active', true)
      .order('order_index'),
  ]);

  if (productRes.error) throw productRes.error;
  if (categoriesRes.error) throw categoriesRes.error;

  return {
    product: productRes.data,
    categories: categoriesRes.data ?? [],
  };
});