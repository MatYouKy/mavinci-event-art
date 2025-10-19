'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, Grid, List, Plug, Trash2, ChevronRight, FolderTree } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ConnectorsView from '@/components/crm/ConnectorsView';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface WarehouseCategory {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  level: number;
  order_index: number;
}

interface EquipmentUnit {
  id: string;
  status: 'available' | 'damaged' | 'in_service' | 'retired';
}

interface Equipment {
  id: string;
  name: string;
  warehouse_category_id: string | null;
  brand: string | null;
  model: string | null;
  thumbnail_url: string | null;
  warehouse_categories: WarehouseCategory | null;
  equipment_units: EquipmentUnit[];
}

export default function EquipmentPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'equipment' | 'cables'>('equipment');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchEquipment();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('warehouse_categories')
      .select('*')
      .eq('is_active', true)
      .order('level')
      .order('order_index');
    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    try {
      setLoading(true);
      const { data } = await supabase
        .from('equipment_items')
        .select(`
          *,
          warehouse_categories(*),
          equipment_units(id, status)
        `)
        .eq('is_active', true)
        .order('name');
      setEquipment(data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć?', 'Usuń');
    if (!confirmed) return;

    try {
      await supabase.from('equipment_items').delete().eq('id', id);
      showSnackbar('Usunięto', 'success');
      fetchEquipment();
    } catch (error) {
      showSnackbar('Błąd', 'error');
    }
  };

  const getCategoryPath = (categoryId: string | null): string => {
    if (!categoryId) return '';
    const category = categories.find(c => c.id === categoryId);
    if (!category) return '';

    let path = category.name;
    let currentParentId = category.parent_id;

    while (currentParentId) {
      const parent = categories.find(c => c.id === currentParentId);
      if (!parent) break;
      path = `${parent.name} > ${path}`;
      currentParentId = parent.parent_id;
    }

    return path;
  };

  const getLeafCategories = () => {
    return categories.filter(cat => cat.level === 3);
  };

  const filtered = equipment.filter((item) => {
    const search = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.brand?.toLowerCase().includes(searchTerm.toLowerCase());
    const category = !selectedCategory || item.warehouse_category_id === selectedCategory;
    return search && category;
  });

  const getStock = (item: Equipment) => {
    const total = item.equipment_units.length;
    const available = item.equipment_units.filter(u => u.status === 'available').length;
    if (total === 0) return { available: 0, total: 0, color: 'text-gray-400' };
    const pct = (available / total) * 100;
    if (pct === 0) return { available, total, color: 'text-red-400' };
    if (pct < 50) return { available, total, color: 'text-orange-400' };
    return { available, total, color: 'text-green-400' };
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  const leafCategories = getLeafCategories();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn sprzętu</h2>
        <div className="flex gap-2">
          {canManageModule('equipment') && (
            <button
              onClick={() => setShowCategoryModal(true)}
              className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40"
            >
              <FolderTree className="w-4 h-4" />
              Kategorie
            </button>
          )}
          {canCreateInModule('equipment') && (
            <button
              onClick={() => router.push('/crm/equipment/new')}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
            >
              <Plus className="w-4 h-4" />
              Dodaj
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-[#d3bb73]/10">
        <button
          onClick={() => setActiveTab('equipment')}
          className={`px-4 py-2 text-sm relative ${activeTab === 'equipment' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Sprzęt
          </div>
          {activeTab === 'equipment' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
        </button>
        <button
          onClick={() => setActiveTab('cables')}
          className={`px-4 py-2 text-sm relative ${activeTab === 'cables' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
        >
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4" />
            Przewody
          </div>
          {activeTab === 'cables' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
        </button>
      </div>

      {activeTab === 'cables' ? (
        <ConnectorsView viewMode={viewMode} />
      ) : (
        <>
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>
            <select
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 text-[#e5e4e2] focus:outline-none min-w-[250px]"
            >
              <option value="">Wszystkie kategorie</option>
              {leafCategories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {getCategoryPath(cat.id)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg ${viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[#e5e4e2]/60">Brak sprzętu</div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(item => {
                const stock = getStock(item);
                return (
                  <div
                    key={item.id}
                    onClick={() => router.push(`/crm/equipment/${item.id}`)}
                    className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 cursor-pointer"
                  >
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt={item.name} className="w-full h-32 object-cover rounded-lg mb-4" />
                    ) : (
                      <div className="w-full h-32 bg-[#0f1119] rounded-lg mb-4 flex items-center justify-center">
                        <Package className="w-12 h-12 text-[#e5e4e2]/40" />
                      </div>
                    )}
                    <h3 className="text-[#e5e4e2] font-medium mb-2">{item.name}</h3>
                    {item.warehouse_category_id && (
                      <p className="text-xs text-[#e5e4e2]/40 mb-2 flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" />
                        {getCategoryPath(item.warehouse_category_id)}
                      </p>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className={stock.color}>{stock.available}/{stock.total}</span>
                      {item.brand && <span className="text-[#e5e4e2]/60">{item.brand}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
              {filtered.map(item => {
                const stock = getStock(item);
                return (
                  <div
                    key={item.id}
                    onClick={() => router.push(`/crm/equipment/${item.id}`)}
                    className="flex items-center gap-4 p-4 hover:bg-[#0f1119] cursor-pointer border-b border-[#d3bb73]/5 last:border-0"
                  >
                    {item.thumbnail_url ? (
                      <img src={item.thumbnail_url} alt={item.name} className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                      <div className="w-12 h-12 bg-[#0f1119] rounded-lg flex items-center justify-center">
                        <Package className="w-6 h-6 text-[#e5e4e2]/40" />
                      </div>
                    )}
                    <div className="flex-1">
                      <h3 className="text-[#e5e4e2] font-medium">{item.name}</h3>
                      <div className="flex gap-2 text-sm text-[#e5e4e2]/60">
                        {item.brand && <span>{item.brand}</span>}
                        {item.warehouse_category_id && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <ChevronRight className="w-3 h-3" />
                              {getCategoryPath(item.warehouse_category_id)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-sm ${stock.color}`}>{stock.available}/{stock.total}</span>
                      {canManageModule('equipment') && (
                        <button
                          onClick={(e) => handleDelete(item.id, e)}
                          className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-light text-[#e5e4e2]">Zarządzanie kategoriami</h3>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2">
              {categories.filter(c => c.level === 0).map(rootCat => (
                <CategoryTree
                  key={rootCat.id}
                  category={rootCat}
                  allCategories={categories}
                  level={0}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryTree({
  category,
  allCategories,
  level,
}: {
  category: WarehouseCategory;
  allCategories: WarehouseCategory[];
  level: number;
}) {
  const children = allCategories.filter(c => c.parent_id === category.id);

  return (
    <div>
      <div
        className={`flex items-center gap-2 p-2 rounded-lg ${
          level === 0 ? 'bg-[#d3bb73]/10' : level === 1 ? 'bg-[#e5e4e2]/5' : 'bg-transparent'
        }`}
        style={{ marginLeft: `${level * 20}px` }}
      >
        <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
        <span className="text-[#e5e4e2]">{category.name}</span>
        {category.description && (
          <span className="text-[#e5e4e2]/40 text-sm">- {category.description}</span>
        )}
      </div>
      {children.map(child => (
        <CategoryTree
          key={child.id}
          category={child}
          allCategories={allCategories}
          level={level + 1}
        />
      ))}
    </div>
  );
}
