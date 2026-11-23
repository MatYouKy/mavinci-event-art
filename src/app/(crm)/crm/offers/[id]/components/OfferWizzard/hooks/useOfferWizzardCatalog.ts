'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { IProduct } from '@/app/(crm)/crm/offers/types';
import { applySeasonPrices, loadSeasonPrices, type SeasonPrices } from '@/lib/CRM/Offers/seasonPrices';
import { productInCategory } from '@/lib/CRM/Offers/productCategories';

/**
 * Katalog kreatora oferty. Ceny produktów i wariantów z cennika sezonowego marki eventu (`loadSeasonPrices`) — bez cennika
 * (albo przed migracją) ceny z katalogu.
 */
export function useOfferWizardCatalog(opts: { isOpen: boolean; step: number; eventId?: string }) {
  const [catalogProducts, setProducts] = useState<IProduct[]>([]);
  const [seasonPrices, setSeasonPrices] = useState<SeasonPrices | null>(null);
  const products = useMemo(() => applySeasonPrices(catalogProducts, seasonPrices), [catalogProducts, seasonPrices]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!opts.isOpen || opts.step !== 3) return;

    (async () => {
      const pRes = await supabase
        .from('offer_products')
        .select(
          `*, variants:offer_product_variants(id, product_id, name, short_description, description, benefits, price_net, price_gross, is_recommended, is_active, display_order, quantity_source, overrides_contract_clauses, recommended_contract_clauses), category:event_categories(name, icon_id, custom_icon:custom_icons(id, name, svg_code, preview_color)), equipment:offer_product_equipment(id), staff:offer_product_staff(hourly_rate, estimated_hours, compensation, is_optional)`,
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

  useEffect(() => {
    if (!opts.isOpen || !opts.eventId) return;
    let active = true;
    void loadSeasonPrices(supabase, { eventId: opts.eventId }).then((prices) => { if (active) setSeasonPrices(prices); });
    return () => { active = false; };
  }, [opts.isOpen, opts.eventId]);

  const filteredProducts = useMemo(() => {
    let filtered = products;

    if (selectedCategory !== 'all') {
      // Kategoria główna albo dodatkowa produktu.
      filtered = filtered.filter((p) => productInCategory(p, selectedCategory));
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
    seasonPrices,
    categories,
    selectedCategory,
    searchQuery,
    filteredProducts,
    setSelectedCategory,
    setSearchQuery,
  };
}
