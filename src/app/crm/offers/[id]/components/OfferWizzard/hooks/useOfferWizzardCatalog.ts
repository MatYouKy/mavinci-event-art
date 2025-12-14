'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Product } from '../types';

export function useOfferWizardCatalog(opts: { isOpen: boolean; step: number }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!opts.isOpen || opts.step !== 3) return;

    (async () => {
      const pRes = await supabase
        .from('offer_products')
        .select(`*, category:offer_product_categories(name, icon)`)
        .eq('is_active', true)
        .order('display_order');

      if (!pRes.error && pRes.data) setProducts(pRes.data as any);

      const cRes = await supabase
        .from('offer_product_categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

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