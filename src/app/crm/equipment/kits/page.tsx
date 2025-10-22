'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2, Package, Search, Edit, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface EquipmentUnit {
  id: string;
  status: 'available' | 'damaged' | 'in_service' | 'retired';
}

interface Equipment {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  thumbnail_url: string | null;
  equipment_units?: EquipmentUnit[];
}

interface KitItem {
  id: string;
  equipment_id: string;
  quantity: number;
  notes: string | null;
  order_index: number;
  equipment_items: Equipment;
}

interface Kit {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  warehouse_category_id: string | null;
  is_active: boolean;
  created_at: string;
  equipment_kit_items: KitItem[];
}

interface WarehouseCategory {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parent_id: string | null;
  level: number;
}

export default function KitsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('equipment');

  const [kits, setKits] = useState<Kit[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingKit, setEditingKit] = useState<Kit | null>(null);
  const [kitForm, setKitForm] = useState({
    name: '',
    description: '',
    thumbnail_url: '',
    warehouse_category_id: '',
  });
  const [kitItems, setKitItems] = useState<{equipment_id: string; quantity: number; notes: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchCategories();
    fetchEquipment();
    fetchKits();
  }, []);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId && kits.length > 0) {
      const kitToEdit = kits.find(k => k.id === editId);
      if (kitToEdit) {
        handleOpenForm(kitToEdit);
      }
    }
  }, [searchParams, kits]);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('warehouse_categories')
      .select('id, name, color, icon, parent_id, level')
      .eq('is_active', true)
      .order('name');
    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    const { data } = await supabase
      .from('equipment_items')
      .select(`
        id,
        name,
        brand,
        model,
        thumbnail_url,
        equipment_units(id, status)
      `)
      .eq('is_active', true)
      .order('name');
    if (data) setEquipment(data);
  };

  const fetchKits = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_kits')
        .select(`
          *,
          equipment_kit_items(
            *,
            equipment_items(id, name, brand, model, thumbnail_url)
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setKits(data || []);
    } catch (error) {
      console.error('Error fetching kits:', error);
      showSnackbar('Błąd podczas pobierania zestawów', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenForm = (kit?: Kit) => {
    if (kit) {
      setEditingKit(kit);
      setKitForm({
        name: kit.name,
        description: kit.description || '',
        thumbnail_url: kit.thumbnail_url || '',
        warehouse_category_id: kit.warehouse_category_id || '',
      });
      setKitItems(kit.equipment_kit_items.map(item => ({
        equipment_id: item.equipment_id,
        quantity: item.quantity,
        notes: item.notes || '',
      })));
    } else {
      setEditingKit(null);
      setKitForm({
        name: '',
        description: '',
        thumbnail_url: '',
        warehouse_category_id: '',
      });
      setKitItems([]);
    }
    setShowAddForm(true);
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-kits');
      setKitForm(prev => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) {
      showSnackbar('Proszę upuścić plik obrazu', 'warning');
      return;
    }

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-kits');
      setKitForm(prev => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleAddKitItem = (equipmentId: string) => {
    if (kitItems.some(item => item.equipment_id === equipmentId)) {
      showSnackbar('Ten sprzęt jest już w zestawie', 'warning');
      return;
    }
    setKitItems(prev => [...prev, { equipment_id: equipmentId, quantity: 1, notes: '' }]);
  };

  const handleRemoveKitItem = (index: number) => {
    setKitItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateKitItem = (index: number, field: 'quantity' | 'notes', value: string) => {
    setKitItems(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: field === 'quantity' ? parseInt(value) || 1 : value } : item
    ));
  };

  const handleSaveKit = async () => {
    if (!kitForm.name.trim()) {
      showSnackbar('Nazwa zestawu jest wymagana', 'warning');
      return;
    }

    if (kitItems.length === 0) {
      showSnackbar('Dodaj przynajmniej jedną pozycję do zestawu', 'warning');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      let kitId = editingKit?.id;

      if (editingKit) {
        const { error: updateError } = await supabase
          .from('equipment_kits')
          .update({
            name: kitForm.name,
            description: kitForm.description || null,
            thumbnail_url: kitForm.thumbnail_url || null,
            warehouse_category_id: kitForm.warehouse_category_id || null,
          })
          .eq('id', editingKit.id);

        if (updateError) throw updateError;

        const { error: deleteError } = await supabase
          .from('equipment_kit_items')
          .delete()
          .eq('kit_id', editingKit.id);

        if (deleteError) throw deleteError;
      } else {
        const { data: newKit, error: insertError } = await supabase
          .from('equipment_kits')
          .insert({
            name: kitForm.name,
            description: kitForm.description || null,
            thumbnail_url: kitForm.thumbnail_url || null,
            warehouse_category_id: kitForm.warehouse_category_id || null,
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        kitId = newKit.id;
      }

      const itemsToInsert = kitItems.map((item, index) => ({
        kit_id: kitId,
        equipment_id: item.equipment_id,
        quantity: item.quantity,
        notes: item.notes || null,
        order_index: index,
      }));

      const { error: itemsError } = await supabase
        .from('equipment_kit_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      showSnackbar(editingKit ? 'Zestaw zaktualizowany' : 'Zestaw utworzony', 'success');
      setShowAddForm(false);
      fetchKits();
    } catch (error) {
      console.error('Error saving kit:', error);
      showSnackbar('Błąd podczas zapisywania zestawu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKit = async (kitId: string) => {
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć ten zestaw?', 'Usuń');
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('equipment_kits')
        .update({ is_active: false })
        .eq('id', kitId);

      if (error) throw error;
      showSnackbar('Zestaw usunięty', 'success');
      fetchKits();
    } catch (error) {
      console.error('Error deleting kit:', error);
      showSnackbar('Błąd podczas usuwania zestawu', 'error');
    }
  };

  const mainCategories = categories.filter(c => c.level === 0);

  const filtered = kits.filter(kit =>
    kit.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (showAddForm) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowAddForm(false)}
              className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
            </button>
            <h2 className="text-2xl font-light text-[#e5e4e2]">
              {editingKit ? 'Edytuj zestaw' : 'Nowy zestaw'}
            </h2>
          </div>
          <button
            onClick={handleSaveKit}
            disabled={saving}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>

        <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka</label>
                {kitForm.thumbnail_url ? (
                  <div className="relative w-full h-48 rounded-lg overflow-hidden bg-[#1c1f33]">
                    <img
                      src={kitForm.thumbnail_url}
                      alt="Miniaturka"
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => setKitForm(prev => ({ ...prev, thumbnail_url: '' }))}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex items-center justify-center w-full h-48 border-2 border-dashed border-[#d3bb73]/20 rounded-lg hover:border-[#d3bb73]/40 cursor-pointer bg-[#1c1f33] transition-colors"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                    <div className="text-center">
                      <Package className="w-12 h-12 mx-auto text-[#e5e4e2]/40 mb-2" />
                      <span className="text-sm text-[#e5e4e2]/40 block">
                        {uploading ? 'Przesyłanie...' : 'Kliknij lub przeciągnij zdjęcie'}
                      </span>
                      <span className="text-xs text-[#e5e4e2]/20 mt-1 block">
                        Obsługiwane formaty: JPG, PNG, WEBP
                      </span>
                    </div>
                  </label>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa zestawu *</label>
                  <input
                    type="text"
                    value={kitForm.name}
                    onChange={(e) => setKitForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="np. Kablarka Standard 1"
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                  <textarea
                    value={kitForm.description}
                    onChange={(e) => setKitForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    placeholder="Krótki opis zestawu..."
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kategoria główna</label>
                  <select
                    value={kitForm.warehouse_category_id}
                    onChange={(e) => setKitForm(prev => ({ ...prev, warehouse_category_id: e.target.value }))}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="">Brak kategorii</option>
                    {mainCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <h5 className="text-[#e5e4e2] font-medium mb-4">Pozycje w zestawie</h5>

              {kitItems.length > 0 && (
                <div className="space-y-3 mb-4">
                  {kitItems.map((item, index) => {
                    const eq = equipment.find(e => e.id === item.equipment_id);
                    return (
                      <div key={index} className="flex items-start gap-3 bg-[#1c1f33] p-3 rounded-lg">
                        {eq?.thumbnail_url && (
                          <img
                            src={eq.thumbnail_url}
                            alt={eq.name}
                            className="w-12 h-12 rounded object-cover"
                          />
                        )}
                        <div className="flex-1">
                          <div className="text-[#e5e4e2] font-medium">{eq?.name || 'Nieznany sprzęt'}</div>
                          {eq?.brand && (
                            <div className="text-sm text-[#e5e4e2]/60">{eq.brand} {eq.model}</div>
                          )}
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="text-xs text-[#e5e4e2]/40">
                                Ilość <span className="text-[#d3bb73]">(maks. {eq?.equipment_units?.filter(u => u.status === 'available').length || 0})</span>
                              </label>
                              <input
                                type="number"
                                min="1"
                                max={eq?.equipment_units?.filter(u => u.status === 'available').length || 0}
                                value={item.quantity}
                                onChange={(e) => handleUpdateKitItem(index, 'quantity', e.target.value)}
                                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded px-2 py-1 text-[#e5e4e2] text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-[#e5e4e2]/40">Notatka</label>
                              <input
                                type="text"
                                value={item.notes}
                                onChange={(e) => handleUpdateKitItem(index, 'notes', e.target.value)}
                                placeholder="opcjonalne"
                                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded px-2 py-1 text-[#e5e4e2] text-sm placeholder-[#e5e4e2]/30"
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveKitItem(index)}
                          className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-4">Dodaj sprzęt do zestawu</label>
                <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg max-h-96 overflow-y-auto">
                  {equipment.length === 0 ? (
                    <div className="p-4 text-center text-[#e5e4e2]/40">Brak dostępnego sprzętu</div>
                  ) : (
                    equipment.map(eq => {
                      const isInKit = kitItems.some(item => item.equipment_id === eq.id);
                      const availableUnits = eq.equipment_units?.filter(u => u.status === 'available').length || 0;
                      return (
                        <label
                          key={eq.id}
                          className={`flex items-center gap-3 p-3 border-b border-[#d3bb73]/5 last:border-0 cursor-pointer hover:bg-[#0f1119] transition-colors ${isInKit ? 'bg-[#d3bb73]/5' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isInKit}
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleAddKitItem(eq.id);
                              } else {
                                const index = kitItems.findIndex(item => item.equipment_id === eq.id);
                                if (index !== -1) handleRemoveKitItem(index);
                              }
                            }}
                            className="w-4 h-4 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0 bg-[#0f1119]"
                          />
                          {eq.thumbnail_url ? (
                            <img
                              src={eq.thumbnail_url}
                              alt={eq.name}
                              className="w-12 h-12 rounded object-cover"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded bg-[#0f1119] flex items-center justify-center">
                              <Package className="w-6 h-6 text-[#e5e4e2]/40" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-[#e5e4e2] font-medium truncate">{eq.name}</div>
                            <div className="text-xs text-[#e5e4e2]/60">
                              {eq.brand && <span>{eq.brand} {eq.model}</span>}
                              {eq.brand && availableUnits > 0 && <span className="mx-1">•</span>}
                              {availableUnits > 0 && <span className="text-[#d3bb73]">{availableUnits} dostępnych</span>}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/equipment')}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
          </button>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Zestawy sprzętowe</h2>
        </div>
        {canManage && (
          <button
            onClick={() => handleOpenForm()}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
          >
            <Plus className="w-4 h-4" />
            Dodaj zestaw
          </button>
        )}
      </div>

      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj zestawów..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-2.5 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-[#e5e4e2]/60">Ładowanie...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-[#e5e4e2]/60">
          {searchTerm ? 'Nie znaleziono zestawów' : 'Brak zestawów'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(kit => {
            const category = categories.find(c => c.id === kit.warehouse_category_id);
            return (
              <div
                key={kit.id}
                className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden hover:border-[#d3bb73]/30 transition-colors"
              >
                {kit.thumbnail_url ? (
                  <div className="h-48 bg-[#0f1119]">
                    <img
                      src={kit.thumbnail_url}
                      alt={kit.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-48 bg-[#0f1119] flex items-center justify-center">
                    <Package className="w-16 h-16 text-[#e5e4e2]/20" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="text-[#e5e4e2] font-medium">{kit.name}</h3>
                      {category && (
                        <div className="text-xs text-[#d3bb73] mt-1">{category.name}</div>
                      )}
                    </div>
                  </div>
                  {kit.description && (
                    <p className="text-sm text-[#e5e4e2]/60 mb-3">{kit.description}</p>
                  )}
                  <div className="text-sm text-[#e5e4e2]/40 mb-3">
                    {kit.equipment_kit_items.length} pozycji
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenForm(kit)}
                        className="flex-1 flex items-center justify-center gap-2 bg-[#0f1119] border border-[#d3bb73]/10 text-[#e5e4e2] px-3 py-2 rounded hover:border-[#d3bb73]/30"
                      >
                        <Edit className="w-4 h-4" />
                        Edytuj
                      </button>
                      <button
                        onClick={() => handleDeleteKit(kit.id)}
                        className="flex items-center justify-center gap-2 bg-[#0f1119] border border-red-500/20 text-red-400 px-3 py-2 rounded hover:border-red-500/40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
