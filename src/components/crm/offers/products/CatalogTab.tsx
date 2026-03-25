import { Grid3x3, List, Package, Plus, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import React, { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';
import Popover from '@/components/UI/Tooltip';

export function CatalogTab({
  products,
  categories,
  productSearch,
  setProductSearch,
  categoryFilter,
  setCategoryFilter,
  viewMode,
  setViewMode,
  router,
}: any) {
  const bucket = useMemo(() => supabase.storage.from('offer-product-pages'), []);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadThumbs = async () => {
      const entries = await Promise.all(
        products.map(async (product: any) => {
          if (!product?.pdf_thumbnail_url) return [product.id, ''] as const;

          const publicUrl = bucket.getPublicUrl(product.pdf_thumbnail_url).data.publicUrl;

          try {
            const res = await fetch(publicUrl, { method: 'HEAD' });
            if (res.ok) return [product.id, publicUrl] as const;
          } catch {}

          const { data } = await bucket.createSignedUrl(product.pdf_thumbnail_url, 3600);
          return [product.id, data?.signedUrl ?? ''] as const;
        }),
      );

      if (!cancelled) {
        setThumbUrls(Object.fromEntries(entries));
      }
    };

    loadThumbs();

    return () => {
      cancelled = true;
    };
  }, [bucket, products]);

  return (
    <>
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Szukaj produktu..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            <option value="all">Wszystkie kategorie</option>
            {categories.map((cat: any) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => router.push('/crm/offers/products/new')}
            className="flex items-center space-x-2 whitespace-nowrap rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            <span>Nowy produkt</span>
          </button>
        </div>

        {products.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak produktów w katalogu</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map((product: any) => {
              const thumbPublicUrl = thumbUrls[product.id] || null;

              return (
                <div
                  key={product.id}
                  onClick={() => router.push(`/crm/offers/products/${product.id}`)}
                  className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-5 transition-all hover:border-[#d3bb73]/30"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <h3 className="mb-1 font-semibold text-[#e5e4e2]">{product.name}</h3>
                      <p className="text-xs text-[#d3bb73]">{product.category?.name}</p>
                    </div>
                    {!product.is_active && (
                      <span className="rounded bg-gray-500/20 px-2 py-1 text-xs text-gray-400">
                        Nieaktywny
                      </span>
                    )}
                  </div>
                  {thumbPublicUrl ? (
                    <Popover
                      trigger={
                        <Image
                          src={thumbPublicUrl}
                          alt={product.name}
                          className="h-21 w-10 object-cover"
                          width={40}
                          height={40}
                        />
                      }
                      content={
                        <Image
                          src={thumbPublicUrl}
                          alt={product.name}
                          className="h-auto w-auto object-cover"
                          width={200}
                          height={100}
                        />
                      }
                      openOn="hover"
                    />
                  ) : (
                    <Package className="h-5 w-5 text-[#d3bb73]" />
                  )}

                  {product.description && (
                    <p className="mb-4 line-clamp-2 text-sm text-[#e5e4e2]/60">
                      {product.description}
                    </p>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#e5e4e2]/60">Cena:</span>
                      <span className="font-medium text-[#d3bb73]">
                        {product.base_price.toLocaleString('pl-PL')} zł/{product.unit}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#e5e4e2]/60">Koszt:</span>
                      <span className="text-[#e5e4e2]/80">
                        {product.cost_price.toLocaleString('pl-PL')} zł
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#e5e4e2]/60">Marża:</span>
                      <span className="font-medium text-green-400">
                        {(
                          ((product.base_price - product.cost_price) / product.base_price) *
                          100
                        ).toFixed(0)}
                        %
                      </span>
                    </div>
                  </div>

                  {product.tags && product.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1">
                      {product.tags.slice(0, 3).map((tag: string, idx: number) => (
                        <span
                          key={idx}
                          className="rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((product: any) => {
              const thumbPublicUrl = thumbUrls[product.id] || null;
              return (
                <div
                  key={product.id}
                  onClick={() => router.push(`/crm/offers/products/${product.id}`)}
                  className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-all hover:border-[#d3bb73]/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-1 items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/20">
                        {thumbPublicUrl ? (
                          <Popover
                            trigger={
                              <Image
                                src={thumbPublicUrl}
                                alt={product.name}
                                className="h-21 w-10 object-cover"
                                width={40}
                                height={40}
                              />
                            }
                            content={
                              <Image
                                src={thumbPublicUrl}
                                alt={product.name}
                                className="h-auto w-auto object-cover"
                                width={200}
                                height={100}
                              />
                            }
                            openOn="hover"
                          />
                        ) : (
                          <Package className="h-5 w-5 text-[#d3bb73]" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-3">
                          <h3 className="font-medium text-[#e5e4e2]">{product.name}</h3>
                          {!product.is_active && (
                            <span className="rounded bg-gray-500/20 px-2 py-0.5 text-xs text-gray-400">
                              Nieaktywny
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/60">
                          <span className="text-[#d3bb73]">{product.category?.name}</span>
                          {product.description && (
                            <span className="line-clamp-1">{product.description}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <div className="mb-1 text-xs text-[#e5e4e2]/60">Cena</div>
                        <div className="font-medium text-[#d3bb73]">
                          {product.base_price.toLocaleString('pl-PL')} zł
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="mb-1 text-xs text-[#e5e4e2]/60">Koszt</div>
                        <div className="text-[#e5e4e2]/80">
                          {product.cost_price.toLocaleString('pl-PL')} zł
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="mb-1 text-xs text-[#e5e4e2]/60">Marża</div>
                        <div className="font-medium text-green-400">
                          {(
                            ((product.base_price - product.cost_price) / product.base_price) *
                            100
                          ).toFixed(0)}
                          %
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
