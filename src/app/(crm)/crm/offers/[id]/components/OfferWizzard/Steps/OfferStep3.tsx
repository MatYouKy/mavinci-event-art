'use client';

import { ShoppingCart, Package, Search } from 'lucide-react';

interface ProductCategory {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  base_price: number;
}

interface OfferItem {
  id: string;
  product_id?: string;
}

interface OfferStep3Props {
  offerItems: OfferItem[];

  searchQuery: string;
  setSearchQuery: (v: string) => void;

  selectedCategory: string;
  setSelectedCategory: (v: string) => void;

  categories: ProductCategory[];
  filteredProducts: Product[];

  addProductToOffer: (product: Product) => void;
  removeOfferItem: (itemId: string) => void;
}

export default function OfferStep3({
  offerItems,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  categories,
  filteredProducts,
  addProductToOffer,
  removeOfferItem,
}: OfferStep3Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Wybierz produkty z katalogu</h3>
        <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <ShoppingCart className="h-4 w-4" />
          <span>{offerItems.length} pozycji w ofercie</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj produktów..."
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
        >
          <option value="all">Wszystkie kategorie</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredProducts.map((product) => {
          const isAdded = offerItems.some((item) => item.product_id === product.id);
          const addedItem = offerItems.find((item) => item.product_id === product.id);

          return (
            <div
              key={product.id}
              className={`rounded-lg border bg-[#1c1f33] p-4 transition-all ${
                isAdded
                  ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                  : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
              }`}
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex flex-1 items-center gap-2">
                  <Package
                    className={`h-5 w-5 ${
                      isAdded ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'
                    }`}
                  />
                  <h4 className="font-medium text-[#e5e4e2]">{product.name}</h4>
                </div>
              </div>
              <p className="mb-3 line-clamp-2 text-sm text-[#e5e4e2]/60">{product.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium text-[#d3bb73]">
                  {product.base_price.toLocaleString('pl-PL')} zł
                </span>
              </div>
              {!isAdded ? (
                <button
                  onClick={() => addProductToOffer(product)}
                  className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                >
                  Dodaj
                </button>
              ) : (
                <button
                  onClick={() => removeOfferItem(addedItem!.id)}
                  className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                >
                  Odejmij
                </button>
              )}
            </div>
          );
        })}
      </div>

      {filteredProducts.length === 0 && (
        <div className="py-12 text-center">
          <Package className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak produktów</p>
        </div>
      )}
    </div>
  );
}