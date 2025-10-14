'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, AlertCircle, Settings, Filter, Grid, List, MapPin, Edit, Trash2, X, Flag, Copy, AlignJustify, Plug } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import KitsManagementModal from '@/components/crm/KitsManagementModal';
import ConnectorsView from '@/components/crm/ConnectorsView';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

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

interface Kit {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  equipment_kit_items: {
    quantity: number;
    equipment_items: {
      equipment_units: EquipmentUnit[];
    };
  }[];
}

export default function EquipmentPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [kits, setKits] = useState<Kit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'equipment' | 'connectors'>('equipment');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchField, setSearchField] = useState<'all' | 'name' | 'brand'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('list');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showLocationsModal, setShowLocationsModal] = useState(false);
  const [showKitsModal, setShowKitsModal] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);

  useEffect(() => {
    loadUserPreferences();
    fetchCategories();
    fetchEquipment();
    fetchKits();
  }, []);

  const loadUserPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: employee } = await supabase
        .from('employees')
        .select('preferred_view_mode')
        .eq('email', user.email)
        .maybeSingle();

      if (employee?.preferred_view_mode) {
        setViewMode(employee.preferred_view_mode as 'grid' | 'list' | 'compact');
      }
    } catch (error) {
      console.error('Error loading user preferences:', error);
    }
  };

  const saveViewModePreference = async (mode: 'grid' | 'list' | 'compact') => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('employees')
        .update({ preferred_view_mode: mode })
        .eq('email', user.email);
    } catch (error) {
      console.error('Error saving view mode preference:', error);
    }
  };

  const handleViewModeChange = (mode: 'grid' | 'list' | 'compact') => {
    setViewMode(mode);
    saveViewModePreference(mode);
  };

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

  const fetchKits = async () => {
    try {
      const { data, error } = await supabase
        .from('equipment_kits')
        .select(`
          *,
          equipment_kit_items(
            quantity,
            equipment_items(
              equipment_units(id, status)
            )
          )
        `)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setKits(data || []);
    } catch (error) {
      console.error('Error fetching kits:', error);
    }
  };

  const handleDuplicateEquipment = async (item: Equipment, e: React.MouseEvent) => {
    e.stopPropagation();

    const confirmed = await showConfirm(`Czy na pewno chcesz zduplikować "${item.name}"?`, 'Duplikuj sprzęt');
    if (!confirmed) return;

    try {
      const baseName = item.name.replace(/\s*\(duplikat(?:\s+\(\d+\))?\)\s*$/i, '').trim();

      const { data: existingDuplicates } = await supabase
        .from('equipment_items')
        .select('name')
        .or(`name.eq.${baseName},name.ilike.${baseName} (duplikat%)`);

      let duplicateNumber = 2;
      if (existingDuplicates && existingDuplicates.length > 0) {
        const numbers = existingDuplicates
          .map(e => {
            if (e.name === `${baseName} (duplikat)`) return 1;
            const match = e.name.match(/\(duplikat \((\d+)\)\)$/);
            return match ? parseInt(match[1]) : 0;
          })
          .filter(n => n > 0);

        if (numbers.length > 0) {
          duplicateNumber = Math.max(...numbers) + 1;
        }
      }

      const newName = duplicateNumber === 2
        ? `${baseName} (duplikat)`
        : `${baseName} (duplikat (${duplicateNumber}))`;

      const { data: newEquipment, error: equipmentError } = await supabase
        .from('equipment_items')
        .insert({
          name: newName,
          brand: item.brand,
          model: item.model,
          category_id: item.category_id,
          description: item.description,
          thumbnail_url: item.thumbnail_url,
          is_active: true,
        })
        .select()
        .single();

      if (equipmentError) throw equipmentError;

      if (item.equipment_stock && item.equipment_stock.length > 0) {
        const stock = item.equipment_stock[0];
        await supabase
          .from('equipment_stock')
          .insert({
            equipment_id: newEquipment.id,
            min_stock_level: stock.min_stock_level || 0,
            max_stock_level: stock.max_stock_level || 0,
          });
      }

      fetchEquipment();
      showSnackbar(`Sprzęt "${newName}" został zduplikowany`, 'success');
    } catch (error) {
      console.error('Error duplicating equipment:', error);
      showSnackbar('Błąd podczas duplikowania sprzętu', 'error');
    }
  };

  const filteredEquipment = equipment.filter((item) => {
    let matchesSearch = false;
    const lowerSearch = searchTerm.toLowerCase();

    if (searchField === 'all') {
      matchesSearch = item.name.toLowerCase().includes(lowerSearch) ||
        item.brand?.toLowerCase().includes(lowerSearch) ||
        item.model?.toLowerCase().includes(lowerSearch);
    } else if (searchField === 'name') {
      matchesSearch = item.name.toLowerCase().includes(lowerSearch);
    } else if (searchField === 'brand') {
      matchesSearch = item.brand?.toLowerCase().includes(lowerSearch) || false;
    }

    const matchesCategory = !selectedCategory || item.category_id === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const filteredKits = kits.filter((kit) => {
    const matchesSearch = kit.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      kit.description?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && !selectedCategory; // zestawy tylko w widoku "Wszystkie"
  });

  const allItems = [
    ...filteredEquipment.map(e => ({ type: 'equipment' as const, data: e })),
    ...filteredKits.map(k => ({ type: 'kit' as const, data: k }))
  ].sort((a, b) => {
    const nameA = a.type === 'equipment' ? a.data.name : a.data.name;
    const nameB = b.type === 'equipment' ? b.data.name : b.data.name;
    return nameA.localeCompare(nameB);
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

  const getKitInfo = (kit: Kit) => {
    let totalRequired = 0;
    let totalAvailable = 0;

    kit.equipment_kit_items.forEach(item => {
      const requiredQty = item.quantity;
      const availableQty = item.equipment_items.equipment_units.filter(u => u.status === 'available').length;
      totalRequired += requiredQty;
      totalAvailable += Math.min(requiredQty, availableQty);
    });

    if (totalRequired === 0) return { available: 0, total: 0, color: 'text-gray-400', label: 'Brak' };

    const percentage = (totalAvailable / totalRequired) * 100;

    if (percentage === 100) return { available: totalAvailable, total: totalRequired, color: 'text-green-400', label: 'Kompletny' };
    if (percentage === 0) return { available: totalAvailable, total: totalRequired, color: 'text-red-400', label: 'Niedostępny' };
    return { available: totalAvailable, total: totalRequired, color: 'text-orange-400', label: 'Niekompletny' };
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
          {activeTab === 'equipment' && (
            <>
              <button
                onClick={() => setShowCategoryModal(true)}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:border-[#d3bb73]/40 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Kategorie
              </button>
              <button
                onClick={() => setShowLocationsModal(true)}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:border-[#d3bb73]/40 transition-colors"
              >
                <MapPin className="w-4 h-4" />
                Lokalizacje
              </button>
              <button
                onClick={() => setShowKitsModal(true)}
                className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:border-[#d3bb73]/40 transition-colors"
              >
                <Package className="w-4 h-4" />
                Zestawy
              </button>
              <button
                onClick={() => router.push('/crm/equipment/new')}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Dodaj sprzęt
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-[#d3bb73]/10">
        <button
          onClick={() => setActiveTab('equipment')}
          className={`px-6 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'equipment'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Sprzęt
          </div>
          {activeTab === 'equipment' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('connectors')}
          className={`px-6 py-3 text-sm font-medium transition-colors relative ${
            activeTab === 'connectors'
              ? 'text-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4" />
            Wtyki
          </div>
          {activeTab === 'connectors' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />
          )}
        </button>
      </div>

      {activeTab === 'connectors' ? (
        <ConnectorsView viewMode={viewMode} />
      ) : (
        <>
          <div className="flex flex-col lg:flex-row gap-4">
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value as any)}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
            >
              <option value="all">Wszystkie pola</option>
              <option value="name">Nazwa</option>
              <option value="brand">Marka</option>
            </select>

            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder={
                  searchField === 'all' ? 'Szukaj sprzętu...' :
                  searchField === 'name' ? 'Szukaj po nazwie...' :
                  'Szukaj po marce...'
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleViewModeChange('compact')}
                className={`p-2.5 rounded-lg transition-colors ${
                  viewMode === 'compact'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2]'
                }`}
                title="Widok kompaktowy"
              >
                <AlignJustify className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={`p-2.5 rounded-lg transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2]'
                }`}
                title="Widok listy"
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-2.5 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2]'
                }`}
                title="Widok kafelków"
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
          Wszystkie ({equipment.length + kits.length})
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

      {allItems.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">
            {searchTerm || selectedCategory ? 'Nie znaleziono sprzętu' : 'Brak sprzętu w magazynie'}
          </p>
        </div>
      ) : viewMode === 'compact' ? (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_120px_100px_80px_80px] gap-2 px-4 py-2 bg-[#d3bb73]/10 border-b border-[#d3bb73]/20 text-xs font-medium text-[#e5e4e2] sticky top-0">
            <div className="w-6"></div>
            <div>Nazwa / Model</div>
            <div>Kategoria</div>
            <div className="text-center">Stan</div>
            <div className="text-center">Dostępne</div>
            <div className="text-center">Razem</div>
          </div>
          {allItems.map((item) => {
            const isKit = item.type === 'kit';
            const stockInfo = isKit ? getKitInfo(item.data) : getStockInfo(item.data);
            const itemData = item.data as any;

            return (
              <div
                key={itemData.id}
                onClick={() => {
                  if (isKit) {
                    setSelectedKitId(itemData.id);
                    setShowKitsModal(true);
                  } else {
                    router.push(`/crm/equipment/${itemData.id}`);
                  }
                }}
                className={`grid grid-cols-[auto_1fr_120px_100px_80px_80px] gap-2 px-4 py-1.5 hover:bg-[#0f1119] cursor-pointer border-b border-[#d3bb73]/5 items-center text-sm group ${
                  isKit ? 'bg-blue-500/5' : ''
                }`}
              >
                <div className="relative w-6 h-6 flex-shrink-0">
                  {isKit && (
                    <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                      <Flag className="w-3 h-3 text-white" />
                    </div>
                  )}
                  {!isKit && itemData.thumbnail_url && (
                    <img
                      src={itemData.thumbnail_url}
                      alt=""
                      className="w-6 h-6 rounded object-cover"
                    />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="font-medium text-[#e5e4e2] truncate">
                    {itemData.name}
                  </div>
                  {!isKit && itemData.equipment_categories?.name?.toLowerCase().includes('przewod') && itemData.cable_specs ? (
                    <div className="text-xs text-[#e5e4e2]/50 truncate">
                      {itemData.cable_specs.length_meters && `${itemData.cable_specs.length_meters}m`}
                      {itemData.cable_specs.connector_in && ` · ${itemData.cable_specs.connector_in}`}
                      {itemData.cable_specs.connector_out && ` → ${itemData.cable_specs.connector_out}`}
                    </div>
                  ) : (
                    <>
                      {!isKit && (itemData.brand || itemData.model) && (
                        <div className="text-xs text-[#e5e4e2]/50 truncate">
                          {itemData.brand} {itemData.model}
                        </div>
                      )}
                      {isKit && itemData.description && (
                        <div className="text-xs text-[#e5e4e2]/50 truncate">
                          {itemData.description}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="text-xs text-[#e5e4e2]/60 truncate">
                  {isKit ? (
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs">ZESTAW</span>
                  ) : (
                    itemData.equipment_categories?.name || '-'
                  )}
                </div>

                <div className={`text-xs ${stockInfo.color} text-center truncate`}>
                  {stockInfo.label}
                </div>

                <div className="text-[#e5e4e2] font-medium text-center">
                  {stockInfo.available}
                </div>

                <div className="text-[#e5e4e2]/60 text-center">
                  {stockInfo.total}
                </div>

                {!isKit && (
                  <button
                    onClick={(e) => handleDuplicateEquipment(itemData, e)}
                    className="absolute right-2 p-1 bg-[#1c1f33] border border-purple-400/30 text-purple-400 rounded hover:bg-purple-500/10 transition-all opacity-0 group-hover:opacity-100"
                    title="Duplikuj"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'grid gap-4'}>
          {allItems.map((item) => {
            const isKit = item.type === 'kit';
            const stockInfo = isKit ? getKitInfo(item.data) : getStockInfo(item.data);
            const itemData = item.data as any;

            return (
              <div
                key={itemData.id}
                className={`bg-[#1c1f33] rounded-xl p-6 transition-all cursor-pointer relative group ${
                  isKit
                    ? 'border-2 border-blue-500/30 hover:border-blue-500/50'
                    : 'border border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                }`}
              >
                <div
                  onClick={() => {
                    if (isKit) {
                      setSelectedKitId(itemData.id);
                      setShowKitsModal(true);
                    } else {
                      router.push(`/crm/equipment/${itemData.id}`);
                    }
                  }}
                  className="flex items-start gap-4"
                >
                  <div className="relative flex-shrink-0">
                    {itemData.thumbnail_url ? (
                      <img
                        src={itemData.thumbnail_url}
                        alt={itemData.name}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${
                        isKit ? 'bg-blue-500/20' : 'bg-[#d3bb73]/20'
                      }`}>
                        <Package className={`w-8 h-8 ${isKit ? 'text-blue-400' : 'text-[#d3bb73]'}`} />
                      </div>
                    )}
                    {isKit && (
                      <div className="absolute -top-1 -right-1 bg-blue-500 rounded-full p-1">
                        <Flag className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-medium text-[#e5e4e2] mb-1 truncate">
                      {itemData.name}
                    </h3>
                    {isKit ? (
                      itemData.description && (
                        <p className="text-sm text-[#e5e4e2]/60 mb-2">
                          {itemData.description}
                        </p>
                      )
                    ) : (
                      (itemData.brand || itemData.model) && (
                        <p className="text-sm text-[#e5e4e2]/60 mb-2">
                          {itemData.brand} {itemData.model}
                        </p>
                      )
                    )}
                    {!isKit && itemData.equipment_categories && (
                      <span className="inline-block px-2 py-1 rounded text-xs bg-[#d3bb73]/20 text-[#d3bb73]">
                        {itemData.equipment_categories.name}
                      </span>
                    )}
                    {isKit && (
                      <div className="text-xs text-[#e5e4e2]/40">
                        {itemData.equipment_kit_items.length} pozycji
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-light text-[#e5e4e2] mb-1">
                      {stockInfo.available} / {stockInfo.total}
                    </div>
                    <div className={`text-sm ${stockInfo.color}`}>{stockInfo.label}</div>
                  </div>
                </div>

                {!isKit && (
                  <button
                    onClick={(e) => handleDuplicateEquipment(itemData, e)}
                    className="absolute top-2 right-2 p-2 bg-[#1c1f33] border border-purple-400/30 text-purple-400 rounded-lg hover:bg-purple-500/10 transition-all opacity-0 group-hover:opacity-100"
                    title="Duplikuj sprzęt"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}

                {!isKit && stockInfo.total > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#d3bb73]/10">
                    <div className="flex justify-between text-xs text-[#e5e4e2]/60 mb-2">
                      <span>Dostępne: {itemData.equipment_units.filter((u: any) => u.status === 'available').length}</span>
                      <span>Uszkodzone: {itemData.equipment_units.filter((u: any) => u.status === 'damaged').length}</span>
                      <span>Serwis: {itemData.equipment_units.filter((u: any) => u.status === 'in_service').length}</span>
                      <span>Wycofane: {itemData.equipment_units.filter((u: any) => u.status === 'retired').length}</span>
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

      {showLocationsModal && (
        <LocationsManagementModal
          onClose={() => setShowLocationsModal(false)}
        />
      )}

      {showKitsModal && (
        <KitsManagementModal
          onClose={() => {
            setShowKitsModal(false);
            setSelectedKitId(null);
            fetchKits();
          }}
          equipment={equipment}
          initialKitId={selectedKitId}
        />
      )}
        </>
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
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();

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

  const handleDeleteCategory = async (id: string, name: string) => {
    const confirmed = await showConfirm(
      `Czy na pewno chcesz usunąć kategorię "${name}"? Ta operacja jest nieodwracalna.`,
      'Usuń kategorię'
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('equipment_categories')
        .delete()
        .eq('id', id);

      if (error) throw error;
      showSnackbar('Kategoria została usunięta', 'success');
      onUpdate();
    } catch (error) {
      console.error('Error deleting category:', error);
      showSnackbar('Błąd podczas usuwania kategorii', 'error');
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
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDeleteCategory(category.id, category.name)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-400 transition-colors"
                    title="Usuń kategorię"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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

function LocationsManagementModal({ onClose }: { onClose: () => void }) {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any>(null);
  const [locationForm, setLocationForm] = useState({
    name: '',
    address: '',
    access_info: '',
    google_maps_url: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('storage_locations')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenForm = (location?: any) => {
    if (location) {
      setEditingLocation(location);
      setLocationForm({
        name: location.name,
        address: location.address || '',
        access_info: location.access_info || '',
        google_maps_url: location.google_maps_url || '',
        notes: location.notes || '',
      });
    } else {
      setEditingLocation(null);
      setLocationForm({
        name: '',
        address: '',
        access_info: '',
        google_maps_url: '',
        notes: '',
      });
    }
    setShowAddForm(true);
  };

  const handleSaveLocation = async () => {
    if (!locationForm.name.trim()) {
      showSnackbar('Nazwa lokalizacji jest wymagana', 'warning');
      return;
    }

    setSaving(true);
    try {
      if (editingLocation) {
        const { error } = await supabase
          .from('storage_locations')
          .update({
            name: locationForm.name,
            address: locationForm.address || null,
            access_info: locationForm.access_info || null,
            google_maps_url: locationForm.google_maps_url || null,
            notes: locationForm.notes || null,
          })
          .eq('id', editingLocation.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('storage_locations')
          .insert({
            name: locationForm.name,
            address: locationForm.address || null,
            access_info: locationForm.access_info || null,
            google_maps_url: locationForm.google_maps_url || null,
            notes: locationForm.notes || null,
          });

        if (error) throw error;
      }

      setShowAddForm(false);
      fetchLocations();
      showSnackbar('Lokalizacja została zapisana', 'success');
    } catch (error) {
      console.error('Error saving location:', error);
      showSnackbar('Błąd podczas zapisywania lokalizacji', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę lokalizację?')) return;

    try {
      const { error } = await supabase
        .from('storage_locations')
        .update({ is_active: false })
        .eq('id', locationId);

      if (error) throw error;
      fetchLocations();
      showSnackbar('Lokalizacja została usunięta', 'success');
    } catch (error) {
      console.error('Error deleting location:', error);
      showSnackbar('Błąd podczas usuwania lokalizacji', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/10">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-light text-[#e5e4e2]">Zarządzanie lokalizacjami</h3>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!showAddForm ? (
            <>
              <button
                onClick={() => handleOpenForm()}
                className="w-full mb-4 flex items-center justify-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2.5 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Dodaj lokalizację
              </button>

              {loading ? (
                <div className="text-center py-8 text-[#e5e4e2]/60">Ładowanie...</div>
              ) : locations.length === 0 ? (
                <div className="text-center py-8">
                  <MapPin className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak lokalizacji</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {locations.map((location) => (
                    <div
                      key={location.id}
                      className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-[#e5e4e2] font-medium mb-2">{location.name}</h4>
                          {location.address && (
                            <p className="text-sm text-[#e5e4e2]/60 mb-1">
                              <span className="font-medium">Adres:</span> {location.address}
                            </p>
                          )}
                          {location.access_info && (
                            <p className="text-sm text-[#e5e4e2]/60 mb-1">
                              <span className="font-medium">Dostęp:</span> {location.access_info}
                            </p>
                          )}
                          {location.google_maps_url && (
                            <a
                              href={location.google_maps_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-2"
                            >
                              <MapPin className="w-3 h-3" />
                              Otwórz w Google Maps
                            </a>
                          )}
                          {location.notes && (
                            <p className="text-sm text-[#e5e4e2]/40 mt-2 italic">
                              {location.notes}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => handleOpenForm(location)}
                            className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteLocation(location.id)}
                            className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <h4 className="text-lg font-medium text-[#e5e4e2] mb-4">
                {editingLocation ? 'Edytuj lokalizację' : 'Nowa lokalizacja'}
              </h4>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa lokalizacji *</label>
                <input
                  type="text"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="np. Magazyn główny, Biuro"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Adres</label>
                <textarea
                  value={locationForm.address}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, address: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Szczegółowy adres lokalizacji"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Informacje o dostępie</label>
                <textarea
                  value={locationForm.access_info}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, access_info: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Kod dostępu, instrukcje wejścia, kontakt"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Link Google Maps</label>
                <input
                  type="url"
                  value={locationForm.google_maps_url}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, google_maps_url: e.target.value }))}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="https://maps.google.com/..."
                />
                <p className="text-xs text-[#e5e4e2]/40 mt-1">
                  Skopiuj link z Google Maps (kliknij prawym i "Kopiuj link")
                </p>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki</label>
                <textarea
                  value={locationForm.notes}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Dodatkowe informacje"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveLocation}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Zapisywanie...' : 'Zapisz'}
                </button>
              </div>
            </div>
          )}
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
