'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Trash2, Package, Search, Edit, Eye, Printer, Copy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';
import { useSnackbar } from '@/contexts/SnackbarContext';
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
}

export default function KitsManagementModal({
  onClose,
  equipment,
  initialKitId,
  inline = false,
}: {
  onClose: () => void;
  equipment: Equipment[];
  initialKitId?: string | null;
  inline?: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('equipment');

  const [kits, setKits] = useState<Kit[]>([]);
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewingKit, setViewingKit] = useState<Kit | null>(null);
  const [editingKit, setEditingKit] = useState<Kit | null>(null);
  const [kitForm, setKitForm] = useState({
    name: '',
    description: '',
    thumbnail_url: '',
    warehouse_category_id: '',
  });
  const [kitItems, setKitItems] = useState<
    { equipment_id: string; quantity: number; notes: string }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchCategories();
    fetchKits();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('warehouse_categories')
      .select('id, name, color, icon')
      .eq('is_active', true)
      .order('name');
    if (data) setCategories(data);
  };

  useEffect(() => {
    if (initialKitId && kits.length > 0) {
      const kit = kits.find((k) => k.id === initialKitId);
      if (kit) {
        setViewingKit(kit);
      }
    }
  }, [initialKitId, kits]);

  const fetchKits = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_kits')
        .select(
          `
          *,
          equipment_kit_items(
            *,
            equipment_items(id, name, brand, model, thumbnail_url)
          )
        `,
        )
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setKits(data || []);
    } catch (error) {
      console.error('Error fetching kits:', error);
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
      setKitItems(
        kit.equipment_kit_items.map((item) => ({
          equipment_id: item.equipment_id,
          quantity: item.quantity,
          notes: item.notes || '',
        })),
      );
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
      setKitForm((prev) => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading image:', error);
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleAddKitItem = (equipmentId: string) => {
    if (kitItems.some((item) => item.equipment_id === equipmentId)) {
      showSnackbar('Ten sprzęt jest już w zestawie', 'warning');
      return;
    }
    setKitItems([...kitItems, { equipment_id: equipmentId, quantity: 1, notes: '' }]);
  };

  const handleRemoveKitItem = (index: number) => {
    setKitItems(kitItems.filter((_, i) => i !== index));
  };

  const handleUpdateKitItem = (
    index: number,
    field: 'quantity' | 'notes',
    value: string | number,
  ) => {
    const updated = [...kitItems];
    if (field === 'quantity') {
      const newQty = typeof value === 'number' ? value : parseInt(value) || 1;
      const equipmentItem = equipment.find((e) => e.id === updated[index].equipment_id);
      const availableQty =
        equipmentItem?.equipment_units?.filter((u) => u.status === 'available').length || 0;

      if (newQty > availableQty) {
        showSnackbar(`Maksymalna dostępna ilość: ${availableQty} szt.`, 'warning');
        return;
      }
      updated[index].quantity = newQty;
    } else {
      updated[index].notes = value as string;
    }
    setKitItems(updated);
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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let kitId = editingKit?.id;

      if (editingKit) {
        // Aktualizacja istniejącego zestawu
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

        // Usuń stare pozycje
        const { error: deleteError } = await supabase
          .from('equipment_kit_items')
          .delete()
          .eq('kit_id', editingKit.id);

        if (deleteError) throw deleteError;
      } else {
        // Tworzenie nowego zestawu
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

      // Dodaj nowe pozycje
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
    if (!confirm('Czy na pewno chcesz usunąć ten zestaw?')) return;

    try {
      const { error } = await supabase
        .from('equipment_kits')
        .update({ is_active: false })
        .eq('id', kitId);

      if (error) throw error;
      fetchKits();
    } catch (error) {
      console.error('Error deleting kit:', error);
      showSnackbar('Błąd podczas usuwania zestawu', 'error');
    }
  };

  const handleDuplicateKit = async (kit: Kit) => {
    try {
      const newKitName = `${kit.name} (duplikat)`;

      const { data: newKit, error: kitError } = await supabase
        .from('equipment_kits')
        .insert({
          name: newKitName,
          description: kit.description,
          thumbnail_url: kit.thumbnail_url,
          is_active: true,
        })
        .select()
        .single();

      if (kitError) throw kitError;

      const itemsToInsert = kit.equipment_kit_items.map((item, index) => ({
        kit_id: newKit.id,
        equipment_id: item.equipment_id,
        quantity: item.quantity,
        notes: item.notes,
        order_index: index,
      }));

      const { error: itemsError } = await supabase
        .from('equipment_kit_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      fetchKits();
      showSnackbar(`Zestaw "${newKitName}" został zduplikowany`, 'success');
    } catch (error) {
      console.error('Error duplicating kit:', error);
      showSnackbar('Błąd podczas duplikowania zestawu', 'error');
    }
  };

  const filteredEquipment = equipment.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.model?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const wrapperClass = inline
    ? 'w-full'
    : 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';

  const contentClass = inline
    ? 'bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl w-full overflow-hidden flex flex-col'
    : 'bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col';

  return (
    <div className={wrapperClass}>
      <div className={contentClass}>
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Zarządzanie zestawami sprzętu</h3>
          {!inline && (
            <button
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:bg-[#e5e4e2]/10"
            >
              <X className="h-5 w-5 text-[#e5e4e2]" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!showAddForm ? (
            <>
              <div className="mb-6 flex items-center justify-between">
                <p className="text-[#e5e4e2]/60">
                  Zestawy pozwalają na grupowanie sprzętu (np. "Kablarka Standard 1")
                </p>
                {canManage && (
                  <button
                    onClick={() => handleOpenForm()}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Plus className="h-4 w-4" />
                    Nowy zestaw
                  </button>
                )}
              </div>

              {loading ? (
                <div className="py-12 text-center text-[#e5e4e2]/60">Ładowanie...</div>
              ) : kits.length === 0 ? (
                <div className="py-12 text-center">
                  <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Brak zestawów</p>
                  <p className="mt-2 text-sm text-[#e5e4e2]/40">
                    Kliknij "Nowy zestaw" aby stworzyć pierwszy zestaw
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {kits.map((kit) => (
                    <div
                      key={kit.id}
                      className="rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                    >
                      <div className="mb-3 flex items-start gap-4">
                        {kit.thumbnail_url ? (
                          <img
                            src={kit.thumbnail_url}
                            alt={kit.name}
                            className="h-16 w-16 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#d3bb73]/20">
                            <Package className="h-8 w-8 text-[#d3bb73]" />
                          </div>
                        )}
                        <div className="flex-1">
                          <h4 className="mb-1 font-medium text-[#e5e4e2]">{kit.name}</h4>
                          {kit.description && (
                            <p className="text-sm text-[#e5e4e2]/60">{kit.description}</p>
                          )}
                          <p className="mt-1 text-xs text-[#e5e4e2]/40">
                            {kit.equipment_kit_items.length} pozycji
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setViewingKit(kit)}
                            className="rounded-lg p-2 text-blue-400 transition-colors hover:bg-blue-500/10"
                            title="Podgląd i drukowanie"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canManage && (
                            <>
                              <button
                                onClick={() => handleDuplicateKit(kit)}
                                className="rounded-lg p-2 text-purple-400 transition-colors hover:bg-purple-500/10"
                                title="Duplikuj zestaw"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleOpenForm(kit)}
                                className="rounded-lg p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteKit(kit.id)}
                                className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {kit.equipment_kit_items.length > 0 && (
                        <div className="space-y-1 pl-20">
                          {kit.equipment_kit_items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 text-sm text-[#e5e4e2]/60"
                            >
                              <span className="text-[#d3bb73]">•</span>
                              <span>{item.quantity}x</span>
                              <span>{item.equipment_items.name}</span>
                              {item.equipment_items.brand && (
                                <span className="text-[#e5e4e2]/40">
                                  ({item.equipment_items.brand})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="mb-4 font-medium text-[#e5e4e2]">
                  {editingKit ? 'Edytuj zestaw' : 'Nowy zestaw'}
                </h4>

                <div className="space-y-4">
                  {kitForm.thumbnail_url && (
                    <div className="relative mx-auto h-32 w-32">
                      <img
                        src={kitForm.thumbnail_url}
                        alt="Miniaturka"
                        className="h-full w-full rounded-lg border border-[#d3bb73]/20 object-cover"
                      />
                      <button
                        onClick={() => setKitForm((prev) => ({ ...prev, thumbnail_url: '' }))}
                        className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Miniaturka (opcjonalna)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailUpload}
                      disabled={uploading}
                      className="hidden"
                      id="kit-thumbnail-upload"
                    />
                    <label
                      htmlFor="kit-thumbnail-upload"
                      className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/30 ${uploading ? 'opacity-50' : ''}`}
                    >
                      <Plus className="h-4 w-4" />
                      {uploading
                        ? 'Przesyłanie...'
                        : kitForm.thumbnail_url
                          ? 'Zmień zdjęcie'
                          : 'Dodaj zdjęcie'}
                    </label>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa zestawu *</label>
                    <input
                      type="text"
                      value={kitForm.name}
                      onChange={(e) => setKitForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="np. Kablarka Standard 1"
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                    <textarea
                      value={kitForm.description}
                      onChange={(e) =>
                        setKitForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      rows={2}
                      placeholder="Krótki opis zestawu..."
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
                    <select
                      value={kitForm.warehouse_category_id}
                      onChange={(e) =>
                        setKitForm((prev) => ({ ...prev, warehouse_category_id: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                    >
                      <option value="">Brak kategorii</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#d3bb73]/10 pt-6">
                <h5 className="mb-4 font-medium text-[#e5e4e2]">Pozycje w zestawie</h5>

                {kitItems.length > 0 && (
                  <div className="mb-4 space-y-3">
                    {kitItems.map((item, index) => {
                      const eq = equipment.find((e) => e.id === item.equipment_id);
                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"
                        >
                          <div className="flex items-start gap-3">
                            {eq?.thumbnail_url && (
                              <img
                                src={eq.thumbnail_url}
                                alt={eq.name}
                                className="h-12 w-12 rounded object-cover"
                              />
                            )}
                            <div className="flex-1">
                              <div className="font-medium text-[#e5e4e2]">
                                {eq?.name || 'Nieznany sprzęt'}
                              </div>
                              {eq?.brand && (
                                <div className="text-sm text-[#e5e4e2]/60">
                                  {eq.brand} {eq.model}
                                </div>
                              )}
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-xs text-[#e5e4e2]/40">
                                    Ilość{' '}
                                    <span className="text-[#d3bb73]">
                                      (maks.{' '}
                                      {eq?.equipment_units?.filter((u) => u.status === 'available')
                                        .length || 0}
                                      )
                                    </span>
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max={
                                      eq?.equipment_units?.filter((u) => u.status === 'available')
                                        .length || 0
                                    }
                                    value={item.quantity}
                                    onChange={(e) =>
                                      handleUpdateKitItem(index, 'quantity', e.target.value)
                                    }
                                    className="w-full rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2]"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-[#e5e4e2]/40">Notatka</label>
                                  <input
                                    type="text"
                                    value={item.notes}
                                    onChange={(e) =>
                                      handleUpdateKitItem(index, 'notes', e.target.value)
                                    }
                                    placeholder="opcjonalne"
                                    className="w-full rounded border border-[#d3bb73]/10 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30"
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveKitItem(index)}
                              className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Search className="h-4 w-4 text-[#e5e4e2]/40" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Szukaj sprzętu do dodania..."
                      className="flex-1 bg-transparent text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none"
                    />
                  </div>

                  <div className="max-h-60 space-y-2 overflow-y-auto">
                    {filteredEquipment.map((item) => {
                      const isAdded = kitItems.some((ki) => ki.equipment_id === item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => !isAdded && handleAddKitItem(item.id)}
                          disabled={isAdded}
                          className={`flex w-full items-center gap-3 rounded-lg p-2 transition-colors ${
                            isAdded ? 'cursor-not-allowed opacity-50' : 'hover:bg-[#1c1f33]'
                          }`}
                        >
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="h-10 w-10 rounded object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded bg-[#d3bb73]/20">
                              <Package className="h-5 w-5 text-[#d3bb73]" />
                            </div>
                          )}
                          <div className="flex-1 text-left">
                            <div className="text-sm text-[#e5e4e2]">{item.name}</div>
                            {item.brand && (
                              <div className="text-xs text-[#e5e4e2]/60">
                                {item.brand} {item.model}
                              </div>
                            )}
                            <div className="mt-1 text-xs text-[#d3bb73]">
                              Dostępne:{' '}
                              {item.equipment_units?.filter((u) => u.status === 'available')
                                .length || 0}{' '}
                              szt.
                            </div>
                          </div>
                          {isAdded && <span className="text-xs text-green-400">✓ Dodano</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 border-t border-[#d3bb73]/10 pt-4">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveKit}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  {saving ? 'Zapisywanie...' : 'Zapisz zestaw'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {viewingKit && (
        <>
          <style>{`
            @media print {
              body * {
                visibility: hidden;
              }
              #kit-checklist-print, #kit-checklist-print * {
                visibility: visible;
              }
              #kit-checklist-print {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                padding: 20mm;
                background: white;
                color: black;
              }
              #kit-checklist-print h1 {
                font-size: 18pt;
                margin-bottom: 10pt;
                font-weight: bold;
              }
              #kit-checklist-print table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10pt;
              }
              #kit-checklist-print th {
                text-align: left;
                padding: 8pt 4pt;
                border-bottom: 2pt solid black;
                font-weight: bold;
              }
              #kit-checklist-print td {
                padding: 6pt 4pt;
                border-bottom: 1pt solid #ccc;
              }
              #kit-checklist-print .checkbox {
                width: 15pt;
                height: 15pt;
                border: 1.5pt solid black;
                display: inline-block;
                margin-right: 8pt;
              }
              @page {
                margin: 15mm;
              }
            }
          `}</style>

          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 print:hidden">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
              <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
                <h3 className="text-xl font-light text-[#e5e4e2]">
                  Podgląd zestawu: {viewingKit.name}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Printer className="h-4 w-4" />
                    Drukuj checklistę
                  </button>
                  <button
                    onClick={() => setViewingKit(null)}
                    className="rounded-lg p-2 transition-colors hover:bg-[#e5e4e2]/10"
                  >
                    <X className="h-5 w-5 text-[#e5e4e2]" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-6 flex items-start gap-4">
                  {viewingKit.thumbnail_url && (
                    <img
                      src={viewingKit.thumbnail_url}
                      alt={viewingKit.name}
                      className="h-24 w-24 rounded-lg object-cover"
                    />
                  )}
                  <div>
                    <h2 className="mb-2 text-2xl font-medium text-[#e5e4e2]">{viewingKit.name}</h2>
                    {viewingKit.description && (
                      <p className="mb-2 text-[#e5e4e2]/60">{viewingKit.description}</p>
                    )}
                    <p className="text-sm text-[#e5e4e2]/40">
                      {viewingKit.equipment_kit_items.length} pozycji • Utworzono:{' '}
                      {new Date(viewingKit.created_at).toLocaleDateString('pl-PL')}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-[#d3bb73]/20">
                  <div className="border-b border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3">
                    <h4 className="font-medium text-[#e5e4e2]">Lista sprzętu</h4>
                  </div>
                  <div className="divide-y divide-[#d3bb73]/10">
                    {viewingKit.equipment_kit_items.map((item, index) => {
                      const availableQty =
                        equipment
                          .find((e) => e.id === item.equipment_id)
                          ?.equipment_units?.filter((u) => u.status === 'available').length || 0;
                      const isAvailable = availableQty >= item.quantity;

                      return (
                        <div
                          key={item.id}
                          className="group flex cursor-pointer items-start gap-4 p-4 transition-colors hover:bg-[#0f1119]"
                          onClick={() => {
                            window.location.href = `/crm/equipment/${item.equipment_id}`;
                          }}
                        >
                          <div className="h-6 w-6 flex-shrink-0 rounded border-2 border-[#d3bb73]/40" />
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="mb-1 flex items-center gap-2">
                                  <span className="font-medium text-[#e5e4e2] group-hover:text-[#d3bb73]">
                                    {index + 1}. {item.equipment_items.name}
                                  </span>
                                  {!isAvailable && (
                                    <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                                      Niewystarczająca ilość
                                    </span>
                                  )}
                                </div>
                                {item.equipment_items.brand && (
                                  <p className="text-sm text-[#e5e4e2]/60">
                                    {item.equipment_items.brand} {item.equipment_items.model}
                                  </p>
                                )}
                                {item.notes && (
                                  <p className="mt-1 text-sm text-[#e5e4e2]/40">
                                    Notatka: {item.notes}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="text-lg font-medium text-[#e5e4e2]">
                                  {item.quantity} szt.
                                </div>
                                <div
                                  className={`text-xs ${isAvailable ? 'text-green-400' : 'text-red-400'}`}
                                >
                                  Dostępne: {availableQty}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Ukryty element do druku */}
          <div id="kit-checklist-print" className="hidden print:block">
            <h1>{viewingKit.name}</h1>
            {viewingKit.description && (
              <p style={{ marginBottom: '10pt' }}>{viewingKit.description}</p>
            )}

            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>✓</th>
                  <th style={{ width: '40px' }}>Lp.</th>
                  <th>Nazwa sprzętu</th>
                  <th>Model</th>
                  <th style={{ width: '60px', textAlign: 'center' }}>Ilość</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>Wydano</th>
                  <th style={{ width: '70px', textAlign: 'center' }}>Zdano</th>
                  <th style={{ width: '120px' }}>Stan na odbiór</th>
                  <th>Notatki</th>
                </tr>
              </thead>
              <tbody>
                {viewingKit.equipment_kit_items.map((item, index) => (
                  <tr key={item.id}>
                    <td>
                      <span className="checkbox"></span>
                    </td>
                    <td>{index + 1}</td>
                    <td>{item.equipment_items.name}</td>
                    <td>
                      {item.equipment_items.brand
                        ? `${item.equipment_items.brand} ${item.equipment_items.model || ''}`
                        : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                    <td style={{ textAlign: 'center' }}>_____</td>
                    <td style={{ textAlign: 'center' }}>_____</td>
                    <td>_________________</td>
                    <td>{item.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: '30pt', borderTop: '1pt solid #ccc', paddingTop: '15pt' }}>
              <p>Data: {new Date().toLocaleDateString('pl-PL')}</p>
              <p style={{ marginTop: '20pt' }}>Osoba wydająca: _____________________________</p>
              <p style={{ marginTop: '20pt' }}>Osoba odbierająca: _____________________________</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
