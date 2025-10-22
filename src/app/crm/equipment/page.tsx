'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, Grid, List, Plug, Trash2, ChevronRight, FolderTree, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ConnectorsView from '@/components/crm/ConnectorsView';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';

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
  is_kit?: boolean;
  description?: string | null;
}

export default function EquipmentPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | 'equipment' | 'kits'>('all');

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

      const [equipmentData, kitsData] = await Promise.all([
        supabase
          .from('equipment_items')
          .select(`
            *,
            warehouse_categories(*),
            equipment_units(id, status)
          `)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('equipment_kits')
          .select(`
            id,
            name,
            description,
            thumbnail_url,
            warehouse_category_id,
            warehouse_categories(*)
          `)
          .eq('is_active', true)
          .order('name')
      ]);

      const equipment = (equipmentData.data || []).map((item: any) => ({
        ...item,
        is_kit: false,
      }));

      const kits = (kitsData.data || []).map((kit: any) => ({
        ...kit,
        is_kit: true,
        brand: null,
        model: null,
        equipment_units: [],
      }));

      setEquipment([...equipment, ...kits]);
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

  const getMainCategories = () => {
    return categories.filter(cat => cat.level === 1);
  };

  const getParentCategoryId = (categoryId: string | null): string | null => {
    if (!categoryId) return null;
    const category = categories.find(c => c.id === categoryId);
    if (!category) return null;

    if (category.level === 1) return category.id;
    if (category.level === 2) return category.parent_id;
    return null;
  };

  const filtered = equipment.filter((item) => {
    const search = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.brand?.toLowerCase().includes(searchTerm.toLowerCase());

    if (activeTab === 'all') return search;
    if (activeTab === 'cables') return false;

    const parentCategoryId = getParentCategoryId(item.warehouse_category_id);
    return search && parentCategoryId === activeTab;
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

  const mainCategories = getMainCategories();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Magazyn</h2>
        <div className="flex gap-2">
          {canManageModule('equipment') && (
            <>
              <button
                onClick={() => router.push('/crm/equipment/categories')}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40"
              >
                <FolderTree className="w-4 h-4" />
                Kategorie
              </button>
              <button
                onClick={() => router.push('/crm/equipment/kits')}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg hover:border-[#d3bb73]/40"
              >
                <Layers className="w-4 h-4" />
                Zestawy
              </button>
            </>
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

      <div className="flex gap-2 border-b border-[#d3bb73]/10 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm relative whitespace-nowrap ${activeTab === 'all' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Wszystko
          </div>
          {activeTab === 'all' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
        </button>
        {mainCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveTab(cat.id)}
            className={`px-4 py-2 text-sm relative whitespace-nowrap ${activeTab === cat.id ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
          >
            {cat.name}
            {activeTab === cat.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
          </button>
        ))}
        <button
          onClick={() => setActiveTab('cables')}
          className={`px-4 py-2 text-sm relative whitespace-nowrap ${activeTab === 'cables' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
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
          {/* Filtr typu: Wszystko / Tylko sprzęt / Tylko zestawy */}
          <div className="flex gap-2">
            <button
              onClick={() => setItemTypeFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                itemTypeFilter === 'all'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              Wszystko
            </button>
            <button
              onClick={() => setItemTypeFilter('equipment')}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                itemTypeFilter === 'equipment'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              Tylko sprzęt
            </button>
            <button
              onClick={() => setItemTypeFilter('kits')}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                itemTypeFilter === 'kits'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              Tylko zestawy
            </button>
          </div>

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
                    className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 cursor-pointer relative"
                  >
                    {canManageModule('equipment') && (
                      <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
                        <ResponsiveActionBar
                          actions={[
                            {
                              label: 'Usuń',
                              onClick: (e) => handleDelete(item.id, e as any),
                              icon: <Trash2 className="w-4 h-4" />,
                              variant: 'danger'
                            }
                          ]}
                        />
                      </div>
                    )}
                    <div className="relative">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt={item.name} className="w-full h-32 object-cover rounded-lg mb-4" />
                      ) : (
                        <div className="w-full h-32 bg-[#0f1119] rounded-lg mb-4 flex items-center justify-center">
                          <Package className="w-12 h-12 text-[#e5e4e2]/40" />
                        </div>
                      )}
                      {item.is_kit && (
                        <div className="absolute top-2 left-2 bg-[#d3bb73] text-[#1c1f33] text-xs font-medium px-2 py-1 rounded">
                          ZESTAW
                        </div>
                      )}
                    </div>
                    <h3 className="text-[#e5e4e2] font-medium mb-2">
                      {item.name}
                      {item.is_kit && <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>}
                    </h3>
                    {item.warehouse_category_id && (
                      <p className="text-xs text-[#e5e4e2]/40 mb-2 flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" />
                        {getCategoryPath(item.warehouse_category_id)}
                      </p>
                    )}
                    <div className="flex justify-between text-sm">
                      {item.is_kit ? (
                        <span className="text-[#e5e4e2]/60 italic">Zestaw</span>
                      ) : (
                        <span className={stock.color}>{stock.available}/{stock.total}</span>
                      )}
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
                    <div className="relative">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt={item.name} className="w-12 h-12 rounded-lg object-cover" />
                      ) : (
                        <div className="w-12 h-12 bg-[#0f1119] rounded-lg flex items-center justify-center">
                          <Package className="w-6 h-6 text-[#e5e4e2]/40" />
                        </div>
                      )}
                      {item.is_kit && (
                        <div className="absolute -top-1 -left-1 bg-[#d3bb73] text-[#1c1f33] text-[10px] font-medium px-1 rounded">
                          KIT
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[#e5e4e2] font-medium">
                        {item.name}
                        {item.is_kit && <span className="ml-2 text-xs text-[#d3bb73]">ZESTAW</span>}
                      </h3>
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
                      {item.is_kit ? (
                        <span className="text-sm text-[#e5e4e2]/60 italic">Zestaw</span>
                      ) : (
                        <span className={`text-sm ${stock.color}`}>{stock.available}/{stock.total}</span>
                      )}
                      {canManageModule('equipment') && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ResponsiveActionBar
                            actions={[
                              {
                                label: 'Usuń',
                                onClick: (e) => handleDelete(item.id, e as any),
                                icon: <Trash2 className="w-4 h-4" />,
                                variant: 'danger'
                              }
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
