'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { IProduct } from '@/app/(crm)/crm/offers/types';

export function useOfferWizardCatalog(opts: { isOpen: boolean; step: number }) {
  const [products, setProducts] = useState<IProduct[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!opts.isOpen || opts.step !== 3) return;

    (async () => {
      const pRes = await supabase
        .from('offer_products')
        .select(
          `*, variants:offer_product_variants(id, product_id, name, short_description, description, benefits, price_net, price_gross, is_recommended, is_active, display_order), category:event_categories(name, icon_id, custom_icon:custom_icons(id, name, svg_code, preview_color))`,
        )
        .eq('is_active', true)
        .order('display_order');

      if (!pRes.error && pRes.data) {
        setProducts(pRes.data.map((product: any) => ({
          ...product,
          variants: [...(product.variants || [])]
            .filter((variant: any) => variant.is_active !== false)
            .sort((a: any, b: any) => a.display_order - b.display_order),
        })) as any);
      }

      const cRes = await supabase
        .from('event_categories')
        .select('*')
        .eq('is_active', true)
        .order('order_index');

      if (!cRes.error && cRes.data) setCategories(cRes.data);
    })();
  }, [opts.isOpen, opts.step]);

  const filteredProducts = useMemo(() => {
    let filtered = products;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category_id === selectedCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q),
      );
    }

    return filtered;
  }, [products, selectedCategory, searchQuery]);

  return {
    products,
    categories,
    selectedCategory,
    searchQuery,
    filteredProducts,
    setSelectedCategory,
    setSearchQuery,
  };
}
