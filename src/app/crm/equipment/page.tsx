'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, AlertCircle, Settings, Filter, Grid, List } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  order_index: number;
  is_active: boolean;
}

interface EquipmentStock {
  total_quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  in_use_quantity: number;
  damaged_quantity: number;
  storage_location: string | null;
}

interface EquipmentUnit {
  id: string;
  equipment_id: string;
  status: 'available' | 'damaged' | 'in_service' | 'retired';
}

interface Equipment {
  id: string;
  name: string;
  category_id: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  equipment_stock: EquipmentStock[];
  equipment_categories: Category | null;
  equipment_units: EquipmentUnit[];
}

export default function EquipmentPage() {
  const router = useRouter();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchEquipment();
  }, []);

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('equipment_categories')
      .select('*')
      .eq('is_active', true)
      .order('order_index');

    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_items')
        .select(`
          *,
          equipment_categories(*),
          equipment_stock(*),
          equipment_units(id, equipment_id, status)
        `)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setEquipment(data || []);
    } catch (error) {
      console.error('Error fetching equipment:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredEquipment = equipment.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.model?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = !selectedCategory || item.category_id === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const getStockInfo = (item: Equipment) => {
    const totalUnits = item.equipment_units.length;
    const availableUnits = item.equipment_units.filter(u => u.status === 'available').length;

    if (totalUnits === 0) return { available: 0, total: 0, color: 'text-gray-400', label: 'Brak' };

    const percentage = (availableUnits / totalUnits) * 100;

    if (percentage === 0) return { available: availableUnits, total: totalUnits, color: 'text-red-400', label: 'Niedostępne' };
    if (percentage < 30) return { available: availableUnits, total: totalUnits, color: 'text-orange-400', label: 'Niski stan' };
    if (percentage < 70) return { available: availableUnits, total: totalUnits, color: 'text-yellow-400', label: 'Średni stan' };
    return { available: availableUnits, total: totalUnits, color: 'text-green-400', label: 'Dostępne' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie sprzętu...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn sprzętu</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCategoryModal(true)}
            className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:border-[#d3bb73]/40 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Kategorie
          </button>
          <button
            onClick={() => router.push('/crm/equipment/new')}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj sprzęt
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj sprzętu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('list')}
            className={`p-2.5 rounded-lg transition-colors ${
              viewMode === 'list'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2]'
            }`}
          >
            <List className="w-5 h-5" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2.5 rounded-lg transition-colors ${
              viewMode === 'grid'
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2]'
            }`}
          >
            <Grid className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-4 py-2 rounded-lg text-sm transition-colors ${
            selectedCategory === null
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] hover:border-[#d3bb73]/40'
          }`}
        >
          Wszystkie ({equipment.length})
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              selectedCategory === category.id
                ? 'bg-[#d3bb73] text-[#1c1f33]'
                : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] hover:border-[#d3bb73]/40'
            }`}
          >
            {category.name} ({equipment.filter(e => e.category_id === category.id).length})
          </button>
        ))}
      </div>

      {filteredEquipment.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm || selectedCategory ? 'Nie znaleziono sprzętu' : 'Brak sprzętu w magazynie'}
          </p>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'grid gap-4'}>
          {filteredEquipment.map((item) => {
            const stockInfo = getStockInfo(item);

            return (
              <div
                key={item.id}
                onClick={() => router.push(`/crm/equipment/${item.id}`)}
                className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  {item.thumbnail_url ? (
                    <img
                      src={item.thumbnail_url}
                      alt={item.name}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Package className="w-8 h-8 text-[#d3bb73]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-medium text-[#e5e4e2] mb-1 truncate">
                      {item.name}
                    </h3>
                    {(item.brand || item.model) && (
                      <p className="text-sm text-[#e5e4e2]/60 mb-2">
                        {item.brand} {item.model}
                      </p>
                    )}
                    {item.equipment_categories && (
                      <span className="inline-block px-2 py-1 rounded text-xs bg-[#d3bb73]/20 text-[#d3bb73]">
                        {item.equipment_categories.name}
                      </span>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-light text-[#e5e4e2] mb-1">
                      {stockInfo.available} / {stockInfo.total}
                    </div>
                    <div className={`text-sm ${stockInfo.color}`}>{stockInfo.label}</div>
                  </div>
                </div>

                {stockInfo.total > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#d3bb73]/10">
                    <div className="flex justify-between text-xs text-[#e5e4e2]/60 mb-2">
                      <span>Dostępne: {item.equipment_units.filter(u => u.status === 'available').length}</span>
                      <span>Uszkodzone: {item.equipment_units.filter(u => u.status === 'damaged').length}</span>
                      <span>Serwis: {item.equipment_units.filter(u => u.status === 'in_service').length}</span>
                      <span>Wycofane: {item.equipment_units.filter(u => u.status === 'retired').length}</span>
                    </div>
                    <div className="h-2 bg-[#0f1119] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#d3bb73] rounded-full transition-all"
                        style={{
                          width: `${(stockInfo.available / stockInfo.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCategoryModal && (
        <CategoryManagementModal
          categories={categories}
          onClose={() => setShowCategoryModal(false)}
          onUpdate={fetchCategories}
        />
      )}
    </div>
  );
}

function CategoryManagementModal({
  categories,
  onClose,
  onUpdate,
}: {
  categories: Category[];
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;

    setSaving(true);
    try {
      const maxOrder = Math.max(...categories.map(c => c.order_index), 0);
      const { error } = await supabase
        .from('equipment_categories')
        .insert({
          name: newCategoryName,
          order_index: maxOrder + 1,
          is_active: true,
        });

      if (error) throw error;

      setNewCategoryName('');
      onUpdate();
    } catch (error) {
      console.error('Error adding category:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCategory = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('equipment_categories')
        .update({ is_active: !isActive })
        .eq('id', id);

      if (error) throw error;
      onUpdate();
    } catch (error) {
      console.error('Error toggling category:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/10">
          <h3 className="text-xl font-light text-[#e5e4e2]">Zarządzanie kategoriami</h3>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-4 mb-6">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-4 bg-[#0f1119] rounded-lg"
              >
                <div>
                  <div className="text-[#e5e4e2] font-medium">{category.name}</div>
                  {category.description && (
                    <div className="text-sm text-[#e5e4e2]/60">{category.description}</div>
                  )}
                </div>
                <button
                  onClick={() => handleToggleCategory(category.id, category.is_active)}
                  className={`px-3 py-1 rounded text-sm ${
                    category.is_active
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {category.is_active ? 'Aktywna' : 'Nieaktywna'}
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-6">
            <h4 className="text-[#e5e4e2] font-medium mb-4">Dodaj nową kategorię</h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Nazwa kategorii"
                className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
              />
              <button
                onClick={handleAddCategory}
                disabled={saving || !newCategoryName.trim()}
                className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Dodawanie...' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10">
          <button
            onClick={onClose}
            className="w-full px-6 py-2.5 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
