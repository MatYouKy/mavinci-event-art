'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Search, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Product {
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  category?: {
    name: string;
  };
}

interface AddOfferItemModalProps {
  offerId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddOfferItemModal({
  offerId,
  onClose,
  onSuccess,
}: AddOfferItemModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    if (selectedProduct) {
      setUnitPrice(selectedProduct.base_price);
    }
  }, [selectedProduct]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_products')
        .select(`
          *,
          category:event_categories(name)
        `)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      showSnackbar('Błąd podczas ładowania produktów', 'error');
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase())
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
        name: selectedProduct.name,
        description: selectedProduct.description,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj pozycję do oferty</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Wyszukaj produkt
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nazwa produktu..."
                className="w-full pl-10 pr-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className={`text-left p-4 rounded-lg border transition-all ${
                  selectedProduct?.id === product.id
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded bg-[#d3bb73]/10">
                    <Package className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-[#e5e4e2] truncate">
                      {product.name}
                    </h3>
                    <p className="text-xs text-[#e5e4e2]/60 mt-1 line-clamp-2">
                      {product.description}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-[#e5e4e2]/40">
                        {product.category?.name}
                      </span>
                      <span className="text-sm font-medium text-[#d3bb73]">
                        {product.base_price.toFixed(2)} PLN
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {selectedProduct && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-6 space-y-4">
              <h3 className="text-lg font-medium text-[#e5e4e2]">Szczegóły pozycji</h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Ilość
                  </label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    min="1"
                    step="1"
                    className="w-full px-4 py-2 bg-[#0d0f1a] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Cena jednostkowa (PLN)
                  </label>
                  <input
                    type="number"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2 bg-[#0d0f1a] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Rabat (%)
                  </label>
                  <input
                    type="number"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full px-4 py-2 bg-[#0d0f1a] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>
              </div>

              <div className="border-t border-[#d3bb73]/10 pt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[#e5e4e2]/60">Wartość brutto:</span>
                  <span className="text-[#e5e4e2]">{subtotal.toFixed(2)} PLN</span>
                </div>
                {discountPercent > 0 && (
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[#e5e4e2]/60">Rabat:</span>
                    <span className="text-green-400">-{discountAmount.toFixed(2)} PLN</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-lg font-medium">
                  <span className="text-[#e5e4e2]">Razem:</span>
                  <span className="text-[#d3bb73]">{total.toFixed(2)} PLN</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={onClose}
            className="px-6 py-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleAddItem}
            disabled={loading || !selectedProduct}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Dodawanie...' : 'Dodaj pozycję'}
          </button>
        </div>
      </div>
    </div>
  );
}
