'use client';

import { useState, useEffect, type ComponentProps } from 'react';
import { X, Plus, Search, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import InquirySourceContextPanel from '@/components/crm/inquiries/InquirySourceContextPanel';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

interface Product {
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  category?: {
    name: string;
  };
  variants?: IProductVariant[];
}

interface AddOfferItemModalProps {
  offerId: string;
  onClose: () => void;
  onSuccess: () => void;
  inquiryContext?: ComponentProps<typeof InquirySourceContextPanel>;
}

export default function AddOfferItemModal({ offerId, onClose, onSuccess, inquiryContext }: AddOfferItemModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<IProductVariant | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [showVariantPricesInPdf, setShowVariantPricesInPdf] = useState(true);
  const [showProductVariantsInPdf, setShowProductVariantsInPdf] = useState(true);

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (selectedProduct) {
      const variants = selectedProduct.variants || [];
      const defaultVariant = variants.find((variant) => variant.is_recommended) || variants[0] || null;
      setSelectedVariant(defaultVariant);
      setUnitPrice(defaultVariant ? Number(defaultVariant.price_net || 0) : selectedProduct.base_price);
    }
  }, [selectedProduct]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_products')
        .select(
          `
          *,
          variants:offer_product_variants(id, product_id, name, short_description, description, benefits, price_net, price_gross, is_recommended, is_active, display_order),
          category:event_categories(name)
        `,
        )
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setProducts((data || []).map((product: any) => ({
        ...product,
        variants: [...(product.variants || [])]
          .filter((variant: IProductVariant) => variant.is_active !== false)
          .sort((a: IProductVariant, b: IProductVariant) => a.display_order - b.display_order),
      })));
    } catch (error) {
      console.error('Error fetching products:', error);
      showSnackbar('Błąd podczas ładowania produktów', 'error');
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleAddItem = async () => {
    if (!selectedProduct) {
      showSnackbar('Wybierz produkt', 'error');
      return;
    }

    if (quantity <= 0) {
      showSnackbar('Ilość musi być większa od 0', 'error');
      return;
    }

    setLoading(true);

    try {
      const calculatedDiscountAmount = (quantity * unitPrice * discountPercent) / 100;

      const { error } = await supabase.from('offer_items').insert({
        offer_id: offerId,
        product_id: selectedProduct.id,
        product_variant_id: selectedVariant?.id || null,
        show_variant_prices_in_pdf: showVariantPricesInPdf,
        show_product_variants_in_pdf: showProductVariantsInPdf,
        name: selectedVariant ? `${selectedProduct.name} — ${selectedVariant.name}` : selectedProduct.name,
        description: selectedVariant?.description || selectedVariant?.short_description || selectedProduct.description,
        quantity,
        unit: selectedProduct.unit,
        unit_price: unitPrice,
        unit_cost: 0,
        discount_percent: discountPercent,
        discount_amount: calculatedDiscountAmount,
        transport_cost: 0,
        logistics_cost: 0,
        display_order: 999,
        notes: null,
      });

      if (error) throw error;

      showSnackbar('Pozycja dodana do oferty', 'success');
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding item:', error);
      showSnackbar('Błąd podczas dodawania pozycji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const subtotal = quantity * unitPrice;
  const discountAmount = (subtotal * discountPercent) / 100;
  const total = subtotal - discountAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj pozycję do oferty</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {inquiryContext && <InquirySourceContextPanel {...inquiryContext} />}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Wyszukaj produkt
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nazwa produktu..."
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid max-h-64 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className={`rounded-lg border p-4 text-left transition-all ${
                  selectedProduct?.id === product.id
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded bg-[#d3bb73]/10 p-2">
                    <Package className="h-5 w-5 text-[#d3bb73]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-[#e5e4e2]">{product.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/60">
                      {product.description}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-[#e5e4e2]/40">{product.category?.name}</span>
                      <span className="text-sm font-medium text-[#d3bb73]">
                        {(product.variants?.length
                          ? Math.min(...product.variants.map((variant) => Number(variant.price_net || 0)))
                          : product.base_price
                        ).toFixed(2)} PLN
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selectedProduct && (
            <div className="space-y-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="text-lg font-medium text-[#e5e4e2]">Szczegóły pozycji</h3>

              {(selectedProduct.variants || []).length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Wariant produktu
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(selectedProduct.variants || []).slice(0, 3).map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => {
                          setSelectedVariant(variant);
                          setUnitPrice(Number(variant.price_net || 0));
                        }}
                        className={`rounded-lg border px-3 py-3 text-left ${
                          selectedVariant?.id === variant.id
                            ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                            : 'border-[#d3bb73]/10 bg-[#0d0f1a]'
                        }`}
                      >
                        <span className="block text-sm font-medium text-[#e5e4e2]">{variant.name}</span>
                        <span className="mt-1 block text-sm text-[#d3bb73]">
                          {Number(variant.price_net || 0).toFixed(2)} PLN
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 space-y-2">
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-3 py-2.5">
                      <span><span className="block text-sm text-[#e5e4e2]">Pokaż wszystkie warianty w PDF</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">Po wyłączeniu drukowany jest tylko wybrany wariant</span></span>
                      <input type="checkbox" checked={showProductVariantsInPdf} onChange={(event) => setShowProductVariantsInPdf(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />
                    </label>
                    <label className={`flex items-center justify-between gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-3 py-2.5 ${showProductVariantsInPdf ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                      <span><span className="block text-sm text-[#e5e4e2]">Pokaż ceny wariantów w PDF</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/40">Cena netto i brutto VAT 23% przy każdym wariancie</span></span>
                      <input type="checkbox" checked={showVariantPricesInPdf} disabled={!showProductVariantsInPdf} onChange={(event) => setShowVariantPricesInPdf(event.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />
                    </label>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Ilość</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min="1"
                    step="1"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Cena jednostkowa (PLN)
                  </label>
                  <input
                    type="number"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    min="0"
                    step="0.01"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rabat (%)</label>
                  <input
                    type="number"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>
              </div>

              <div className="border-t border-[#d3bb73]/10 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[#e5e4e2]/60">Wartość brutto:</span>
                  <span className="text-[#e5e4e2]">{subtotal.toFixed(2)} PLN</span>
                </div>
                {discountPercent > 0 && (
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[#e5e4e2]/60">Rabat:</span>
                    <span className="text-green-400">-{discountAmount.toFixed(2)} PLN</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-lg font-medium">
                  <span className="text-[#e5e4e2]">Razem:</span>
                  <span className="text-[#d3bb73]">{total.toFixed(2)} PLN</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            className="rounded-lg px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
          <button
            onClick={handleAddItem}
            disabled={loading || !selectedProduct}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : 'Dodaj pozycję'}
          </button>
        </div>
      </div>
    </div>
  );
}
