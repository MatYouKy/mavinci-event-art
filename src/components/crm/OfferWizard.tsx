'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, ShoppingCart, Package, Search, ChevronRight, ChevronLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Product {
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  category?: {
    name: string;
    icon: string;
  };
}

interface OfferItem {
  id: string;
  product_id?: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  subtotal: number;
}

interface OfferWizardProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  clientId: string;
  onSuccess: () => void;
}

export default function OfferWizard({
  isOpen,
  onClose,
  eventId,
  clientId,
  onSuccess,
}: OfferWizardProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Podstawowe dane oferty
  const [offerData, setOfferData] = useState({
    offer_number: '',
    valid_until: '',
    notes: '',
  });

  // Step 2: Produkty z katalogu
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

  // Step 3: Pozycje oferty
  const [offerItems, setOfferItems] = useState<OfferItem[]>([]);
  const [showCustomItemForm, setShowCustomItemForm] = useState(false);
  const [customItem, setCustomItem] = useState({
    name: '',
    description: '',
    quantity: 1,
    unit: 'szt',
    unit_price: 0,
    discount_percent: 0,
  });

  useEffect(() => {
    if (isOpen && step === 2) {
      fetchProducts();
      fetchCategories();
    }
  }, [isOpen, step]);

  useEffect(() => {
    filterProducts();
  }, [products, selectedCategory, searchQuery]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_products')
        .select(`
          *,
          category:offer_product_categories(name, icon)
        `)
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      if (data) setProducts(data);
    } catch (err) {
      console.error('Error fetching products:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_product_categories')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      if (data) setCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const filterProducts = () => {
    let filtered = products;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category_id === selectedCategory);
    }

    if (searchQuery) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredProducts(filtered);
  };

  const addProductToOffer = (product: Product) => {
    const existingItem = offerItems.find((item) => item.product_id === product.id);

    if (existingItem) {
      setOfferItems(
        offerItems.map((item) =>
          item.id === existingItem.id
            ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.unit_price * (1 - item.discount_percent / 100) }
            : item
        )
      );
    } else {
      const newItem: OfferItem = {
        id: `temp-${Date.now()}`,
        product_id: product.id,
        name: product.name,
        description: product.description || '',
        quantity: 1,
        unit: product.unit,
        unit_price: product.base_price,
        discount_percent: 0,
        subtotal: product.base_price,
      };
      setOfferItems([...offerItems, newItem]);
    }
  };

  const addCustomItem = () => {
    if (!customItem.name || customItem.unit_price <= 0) {
      alert('Podaj nazwę i cenę pozycji');
      return;
    }

    const subtotal = customItem.quantity * customItem.unit_price * (1 - customItem.discount_percent / 100);

    const newItem: OfferItem = {
      id: `temp-${Date.now()}`,
      name: customItem.name,
      description: customItem.description,
      quantity: customItem.quantity,
      unit: customItem.unit,
      unit_price: customItem.unit_price,
      discount_percent: customItem.discount_percent,
      subtotal,
    };

    setOfferItems([...offerItems, newItem]);
    setCustomItem({
      name: '',
      description: '',
      quantity: 1,
      unit: 'szt',
      unit_price: 0,
      discount_percent: 0,
    });
    setShowCustomItemForm(false);
  };

  const updateOfferItem = (id: string, updates: Partial<OfferItem>) => {
    setOfferItems(
      offerItems.map((item) => {
        if (item.id === id) {
          const updated = { ...item, ...updates };
          updated.subtotal = updated.quantity * updated.unit_price * (1 - updated.discount_percent / 100);
          return updated;
        }
        return item;
      })
    );
  };

  const removeOfferItem = (id: string) => {
    setOfferItems(offerItems.filter((item) => item.id !== id));
  };

  const calculateTotal = () => {
    return offerItems.reduce((sum, item) => sum + item.subtotal, 0);
  };

  const handleSubmit = async () => {
    if (offerItems.length === 0) {
      alert('Dodaj przynajmniej jedną pozycję do oferty');
      return;
    }

    setLoading(true);

    try {
      // 1. Utwórz ofertę
      const offerDataToInsert: any = {
        event_id: eventId,
        client_id: clientId,
        valid_until: offerData.valid_until || null,
        notes: offerData.notes || null,
        status: 'draft',
        total_amount: calculateTotal(),
      };

      if (offerData.offer_number.trim()) {
        offerDataToInsert.offer_number = offerData.offer_number;
      }

      const { data: offerResult, error: offerError } = await supabase
        .from('offers')
        .insert([offerDataToInsert])
        .select()
        .single();

      if (offerError) throw offerError;

      // 2. Dodaj pozycje oferty
      const itemsToInsert = offerItems.map((item) => ({
        offer_id: offerResult.id,
        product_id: item.product_id || null,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent,
        discount_amount: 0,
        subtotal: item.subtotal,
        vat_rate: 23,
        total: item.subtotal,
      }));

      const { error: itemsError } = await supabase
        .from('offer_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      alert(`Utworzono ofertę: ${offerResult.offer_number}`);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error creating offer:', err);
      alert('Błąd podczas tworzenia oferty: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">Kreator oferty</h2>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              Krok {step} z 3
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-[#d3bb73]/10">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                step >= 1 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
              }`}>
                1
              </div>
              <span className={`text-sm ${step >= 1 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                Dane podstawowe
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-[#e5e4e2]/40" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                step >= 2 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
              }`}>
                2
              </div>
              <span className={`text-sm ${step >= 2 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                Katalog produktów
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-[#e5e4e2]/40" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                step >= 3 ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/40'
              }`}>
                3
              </div>
              <span className={`text-sm ${step >= 3 ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/40'}`}>
                Pozycje i podsumowanie
              </span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Podstawowe dane */}
          {step === 1 && (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="text-sm text-blue-400">
                  Numer oferty zostanie wygenerowany automatycznie w formacie OF/RRRR/MM/NNN (np. OF/2025/11/001)
                </p>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Numer oferty (opcjonalnie)
                </label>
                <input
                  type="text"
                  value={offerData.offer_number}
                  onChange={(e) => setOfferData({ ...offerData, offer_number: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Zostaw puste dla automatycznego numeru"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Ważna do
                </label>
                <input
                  type="date"
                  value={offerData.valid_until}
                  onChange={(e) => setOfferData({ ...offerData, valid_until: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Notatki
                </label>
                <textarea
                  value={offerData.notes}
                  onChange={(e) => setOfferData({ ...offerData, notes: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[100px] focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Dodatkowe informacje o ofercie..."
                />
              </div>
            </div>
          )}

          {/* Step 2: Katalog produktów */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  Wybierz produkty z katalogu
                </h3>
                <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                  <ShoppingCart className="w-4 h-4" />
                  <span>{offerItems.length} pozycji w ofercie</span>
                </div>
              </div>

              {/* Filters */}
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Szukaj produktów..."
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  />
                </div>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg p-4 hover:border-[#d3bb73]/30 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-[#d3bb73]" />
                        <h4 className="font-medium text-[#e5e4e2]">{product.name}</h4>
                      </div>
                    </div>
                    <p className="text-sm text-[#e5e4e2]/60 mb-3 line-clamp-2">
                      {product.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-medium text-[#d3bb73]">
                        {product.base_price.toLocaleString('pl-PL')} zł
                      </span>
                      <button
                        onClick={() => addProductToOffer(product)}
                        className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors text-sm"
                      >
                        Dodaj
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {filteredProducts.length === 0 && (
                <div className="text-center py-12">
                  <Package className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak produktów</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Pozycje oferty */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  Pozycje oferty
                </h3>
                <button
                  onClick={() => setShowCustomItemForm(true)}
                  className="px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Dodaj niestandardową pozycję</span>
                </button>
              </div>

              {/* Custom Item Form */}
              {showCustomItemForm && (
                <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-[#e5e4e2] mb-4">
                    Niestandardowa pozycja
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa *</label>
                      <input
                        type="text"
                        value={customItem.name}
                        onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        placeholder="np. Pokaz iskier"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                      <textarea
                        value={customItem.description}
                        onChange={(e) => setCustomItem({ ...customItem, description: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ilość *</label>
                      <input
                        type="number"
                        value={customItem.quantity}
                        onChange={(e) => setCustomItem({ ...customItem, quantity: parseInt(e.target.value) || 1 })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        min="1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Jednostka</label>
                      <input
                        type="text"
                        value={customItem.unit}
                        onChange={(e) => setCustomItem({ ...customItem, unit: e.target.value })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Cena jedn. (zł) *</label>
                      <input
                        type="number"
                        value={customItem.unit_price}
                        onChange={(e) => setCustomItem({ ...customItem, unit_price: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-[#e5e4e2]/60 mb-2">Rabat (%)</label>
                      <input
                        type="number"
                        value={customItem.discount_percent}
                        onChange={(e) => setCustomItem({ ...customItem, discount_percent: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        min="0"
                        max="100"
                        step="0.01"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={addCustomItem}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
                    >
                      Dodaj
                    </button>
                    <button
                      onClick={() => setShowCustomItemForm(false)}
                      className="px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] rounded-lg"
                    >
                      Anuluj
                    </button>
                  </div>
                </div>
              )}

              {/* Offer Items Table */}
              <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[#0f1119]">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm text-[#e5e4e2]/60">Nazwa</th>
                      <th className="text-center py-3 px-4 text-sm text-[#e5e4e2]/60">Ilość</th>
                      <th className="text-center py-3 px-4 text-sm text-[#e5e4e2]/60">Jedn.</th>
                      <th className="text-right py-3 px-4 text-sm text-[#e5e4e2]/60">Cena jedn.</th>
                      <th className="text-right py-3 px-4 text-sm text-[#e5e4e2]/60">Rabat</th>
                      <th className="text-right py-3 px-4 text-sm text-[#e5e4e2]/60">Wartość</th>
                      <th className="py-3 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {offerItems.map((item) => (
                      <tr key={item.id} className="border-t border-[#d3bb73]/10">
                        <td className="py-3 px-4">
                          <div>
                            <div className="text-[#e5e4e2] font-medium">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-[#e5e4e2]/60">{item.description}</div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateOfferItem(item.id, { quantity: parseInt(e.target.value) || 1 })}
                            className="w-20 bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-1 text-center text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                            min="1"
                          />
                        </td>
                        <td className="py-3 px-4 text-center text-[#e5e4e2]/60">{item.unit}</td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            value={item.unit_price}
                            onChange={(e) => updateOfferItem(item.id, { unit_price: parseFloat(e.target.value) || 0 })}
                            className="w-24 bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-1 text-right text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                            min="0"
                            step="0.01"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            value={item.discount_percent}
                            onChange={(e) => updateOfferItem(item.id, { discount_percent: parseFloat(e.target.value) || 0 })}
                            className="w-20 bg-[#0f1119] border border-[#d3bb73]/20 rounded px-2 py-1 text-right text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                            min="0"
                            max="100"
                            step="0.01"
                          />
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-[#d3bb73]">
                          {item.subtotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => removeOfferItem(item.id)}
                            className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                            title="Usuń"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#0f1119] border-t-2 border-[#d3bb73]/30">
                    <tr>
                      <td colSpan={5} className="py-4 px-4 text-right font-medium text-[#e5e4e2]">
                        Razem:
                      </td>
                      <td className="py-4 px-4 text-right text-xl font-medium text-[#d3bb73]">
                        {calculateTotal().toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {offerItems.length === 0 && (
                <div className="text-center py-12">
                  <ShoppingCart className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">
                    Brak pozycji w ofercie. Wróć do kroku 2 aby dodać produkty z katalogu.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-4 py-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-5 h-5" />
            <span>Wstecz</span>
          </button>

          <div className="flex gap-3">
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 font-medium"
              >
                <span>Dalej</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading || offerItems.length === 0}
                className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Tworzenie...' : 'Utwórz ofertę'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
