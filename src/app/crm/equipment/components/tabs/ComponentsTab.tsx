import { useState, useEffect } from 'react';
import { Plus, Trash2, Package, Search, X, Upload, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';

interface EquipmentItem {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  thumbnail_url: string | null;
  cable_stock_quantity?: number | null;
  equipment_units?: Array<{ id: string; status: string }>;
  warehouse_categories?: {
    name: string;
  } | Array<{ name: string }>;
}

export function ComponentsTab({ equipment, isEditing, onAdd, onDelete }: any) {
  const [isAdding, setIsAdding] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [availableEquipment, setAvailableEquipment] = useState<EquipmentItem[]>([]);
  const [filteredEquipment, setFilteredEquipment] = useState<EquipmentItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [componentType, setComponentType] = useState<'from_warehouse' | 'custom'>('from_warehouse');
  const [newComponent, setNewComponent] = useState({
    component_equipment_id: '',
    component_name: '',
    quantity: 1,
    description: '',
    maxQuantity: 999,
    thumbnail_url: '',
    technical_specs: {} as Record<string, string>
  });
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [techSpecKey, setTechSpecKey] = useState('');
  const [techSpecValue, setTechSpecValue] = useState('');

  const [compatibleItems, setCompatibleItems] = useState<any[]>([]);
  const [showCompatibleModal, setShowCompatibleModal] = useState(false);
  const [compatibilityType, setCompatibilityType] = useState<'required' | 'recommended' | 'optional'>('optional');
  const [compatibilityNotes, setCompatibilityNotes] = useState('');

  const getAvailableQuantity = (item: EquipmentItem): number => {
    if (item.cable_stock_quantity !== undefined && item.cable_stock_quantity !== null && item.cable_stock_quantity > 0) {
      return item.cable_stock_quantity;
    }
    if (item.equipment_units && Array.isArray(item.equipment_units)) {
      return item.equipment_units.length;
    }
    return 0;
  };

  useEffect(() => {
    if (isAdding || showEquipmentModal || showCompatibleModal) {
      fetchAvailableEquipment();
    }
  }, [isAdding, showEquipmentModal, showCompatibleModal]);

  useEffect(() => {
    if (equipment?.id) {
      fetchCompatibleItems();
    }
  }, [equipment?.id]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredEquipment(availableEquipment);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredEquipment(
        availableEquipment.filter(
          (item) => {
            const categoryName = Array.isArray(item.warehouse_categories)
              ? item.warehouse_categories[0]?.name
              : item.warehouse_categories?.name;
            return (
              item.name.toLowerCase().includes(query) ||
              item.model?.toLowerCase().includes(query) ||
              item.brand?.toLowerCase().includes(query) ||
              categoryName?.toLowerCase().includes(query)
            );
          }
        )
      );
    }
  }, [searchQuery, availableEquipment]);

  const fetchAvailableEquipment = async () => {
    const { data, error } = await supabase
      .from('equipment_items')
      .select(`
        id,
        name,
        model,
        brand,
        thumbnail_url,
        cable_stock_quantity,
        warehouse_categories(name),
        equipment_units(id, status)
      `)
      .is('deleted_at', null)
      .neq('id', equipment.id)
      .order('name');

    if (error) {
      console.error('Error fetching equipment:', error);
      return;
    }

    if (data) {
      setAvailableEquipment(data);
      setFilteredEquipment(data);
    }
  };

  const fetchCompatibleItems = async () => {
    const { data, error } = await supabase
      .from('equipment_compatible_items')
      .select(`
        id,
        compatibility_type,
        notes,
        display_order,
        compatible_equipment:compatible_equipment_id(
          id,
          name,
          model,
          brand,
          thumbnail_url,
          cable_stock_quantity,
          warehouse_categories(name),
          equipment_units(id, status)
        )
      `)
      .eq('equipment_id', equipment.id)
      .order('display_order');

    if (error) {
      console.error('Error fetching compatible items:', error);
      return;
    }

    if (data) {
      setCompatibleItems(data);
    }
  };

  const handleAddCompatible = async (compatibleEquipmentId: string) => {
    try {
      const { error } = await supabase
        .from('equipment_compatible_items')
        .insert({
          equipment_id: equipment.id,
          compatible_equipment_id: compatibleEquipmentId,
          compatibility_type: compatibilityType,
          notes: compatibilityNotes || null,
          display_order: compatibleItems.length,
        });

      if (error) throw error;
      await fetchCompatibleItems();
      setShowCompatibleModal(false);
      setCompatibilityNotes('');
      setCompatibilityType('optional');
      setSearchQuery('');
    } catch (error) {
      console.error('Error adding compatible item:', error);
      alert('Błąd podczas dodawania kompatybilnego produktu');
    }
  };

  const handleDeleteCompatible = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten kompatybilny produkt?')) return;

    try {
      const { error } = await supabase
        .from('equipment_compatible_items')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchCompatibleItems();
    } catch (error) {
      console.error('Error deleting compatible item:', error);
      alert('Błąd podczas usuwania kompatybilnego produktu');
    }
  };

  const handleSelectEquipment = (equipmentId: string) => {
    const selected = availableEquipment.find((e) => e.id === equipmentId);
    if (selected) {
      const maxQty = getAvailableQuantity(selected);
      setNewComponent((p) => ({
        ...p,
        component_equipment_id: equipmentId,
        component_name: `${selected.name}${selected.model ? ` ${selected.model}` : ''}`,
        maxQuantity: maxQty,
        quantity: Math.min(p.quantity, maxQty)
      }));
    }
    setShowEquipmentModal(false);
    setSearchQuery('');
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingThumb(true);
    try {
      const url = await uploadImage(file, 'equipment-components');
      setNewComponent((prev) => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploadingThumb(false);
    }
  };

  const handleAddTechSpec = () => {
    if (!techSpecKey.trim() || !techSpecValue.trim()) return;
    setNewComponent((prev) => ({
      ...prev,
      technical_specs: {
        ...prev.technical_specs,
        [techSpecKey]: techSpecValue
      }
    }));
    setTechSpecKey('');
    setTechSpecValue('');
  };

  const handleRemoveTechSpec = (key: string) => {
    setNewComponent((prev) => {
      const newSpecs = { ...prev.technical_specs };
      delete newSpecs[key];
      return { ...prev, technical_specs: newSpecs };
    });
  };

  const handleAdd = async () => {
    if (componentType === 'from_warehouse' && !newComponent.component_equipment_id) {
      return;
    }
    if (componentType === 'custom' && !newComponent.component_name.trim()) {
      return;
    }

    const selectedEquipment = availableEquipment.find(e => e.id === newComponent.component_equipment_id);

    await onAdd({
      equipment_id: equipment.id,
      component_equipment_id: componentType === 'from_warehouse' ? newComponent.component_equipment_id : null,
      component_name: componentType === 'from_warehouse'
        ? (selectedEquipment ? `${selectedEquipment.name}${selectedEquipment.model ? ` ${selectedEquipment.model}` : ''}` : '')
        : newComponent.component_name,
      quantity: newComponent.quantity,
      description: newComponent.description || null,
      is_included: true,
      is_integral: componentType === 'custom',
      thumbnail_url: componentType === 'custom' ? (newComponent.thumbnail_url || null) : null,
      technical_specs: componentType === 'custom' && Object.keys(newComponent.technical_specs).length > 0
        ? newComponent.technical_specs
        : null,
    });
    setNewComponent({
      component_equipment_id: '',
      component_name: '',
      quantity: 1,
      description: '',
      maxQuantity: 999,
      thumbnail_url: '',
      technical_specs: {}
    });
    setComponentType('from_warehouse');
    setIsAdding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Skład zestawu</h3>
        {isEditing && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
          >
            <Plus className="w-4 h-4" />
            Dodaj komponent
          </button>
        )}
      </div>

      {isAdding && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 space-y-4">
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={componentType === 'from_warehouse'}
                onChange={() => setComponentType('from_warehouse')}
                className="w-4 h-4 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-[#e5e4e2]">Z magazynu</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={componentType === 'custom'}
                onChange={() => setComponentType('custom')}
                className="w-4 h-4 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-[#e5e4e2]">Własna nazwa</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {componentType === 'from_warehouse' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowEquipmentModal(true)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] text-left hover:border-[#d3bb73]/30 flex items-center justify-between"
                >
                  <span className={newComponent.component_name ? '' : 'text-[#e5e4e2]/50'}>
                    {newComponent.component_name || 'Wybierz sprzęt z magazynu'}
                  </span>
                  <Search className="w-4 h-4" />
                </button>
                {newComponent.component_equipment_id && (
                  <div className="text-xs text-[#d3bb73]">
                    Dostępne: {newComponent.maxQuantity} szt.
                  </div>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={newComponent.component_name}
                onChange={(e) => setNewComponent((p) => ({ ...p, component_name: e.target.value }))}
                placeholder="Nazwa komponentu"
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            )}
            <div className="space-y-2">
              <input
                type="number"
                min={1}
                max={componentType === 'from_warehouse' ? newComponent.maxQuantity : undefined}
                value={newComponent.quantity}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  const maxQty = componentType === 'from_warehouse' ? newComponent.maxQuantity : 999;
                  setNewComponent((p) => ({ ...p, quantity: Math.min(Math.max(val, 1), maxQty) }));
                }}
                placeholder="Ilość"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
              {componentType === 'from_warehouse' && newComponent.component_equipment_id && (
                <div className="text-xs text-[#e5e4e2]/60">
                  Maks: {newComponent.maxQuantity}
                </div>
              )}
            </div>
            <input
              type="text"
              value={newComponent.description}
              onChange={(e) => setNewComponent((p) => ({ ...p, description: e.target.value }))}
              placeholder="Opis (opcjonalnie)"
              className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          {componentType === 'custom' && (
            <div className="space-y-4 border-t border-[#d3bb73]/10 pt-4">
              <h4 className="text-sm font-medium text-[#e5e4e2]">Komponent integralny - Szczegóły</h4>

              {newComponent.thumbnail_url && (
                <div className="relative w-32 h-32">
                  <img
                    src={newComponent.thumbnail_url}
                    alt="Miniaturka"
                    className="w-full h-full object-cover rounded-lg border border-[#d3bb73]/20"
                  />
                  <button
                    onClick={() => setNewComponent((prev) => ({ ...prev, thumbnail_url: '' }))}
                    className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Zdjęcie komponentu (opcjonalne)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailUpload}
                  disabled={uploadingThumb}
                  className="hidden"
                  id="component-thumbnail-upload"
                />
                <label
                  htmlFor="component-thumbnail-upload"
                  className={`flex items-center justify-center gap-2 w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] cursor-pointer hover:border-[#d3bb73]/30 transition-colors ${
                    uploadingThumb ? 'opacity-50' : ''
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  {uploadingThumb
                    ? 'Przesyłanie...'
                    : newComponent.thumbnail_url
                    ? 'Zmień zdjęcie'
                    : 'Dodaj zdjęcie'}
                </label>
              </div>

              <div className="space-y-2">
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Parametry techniczne</label>
                {Object.entries(newComponent.technical_specs).length > 0 && (
                  <div className="space-y-2 mb-3">
                    {Object.entries(newComponent.technical_specs).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2">
                        <span className="text-[#e5e4e2] flex-1">
                          <span className="font-medium">{key}:</span> {value}
                        </span>
                        <button
                          onClick={() => handleRemoveTechSpec(key)}
                          className="p-1 text-red-400 hover:text-red-300"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={techSpecKey}
                    onChange={(e) => setTechSpecKey(e.target.value)}
                    placeholder="Nazwa parametru (np. Moc)"
                    className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                  <input
                    type="text"
                    value={techSpecValue}
                    onChange={(e) => setTechSpecValue(e.target.value)}
                    placeholder="Wartość (np. 500W)"
                    className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                  <button
                    onClick={handleAddTechSpec}
                    className="px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setComponentType('from_warehouse');
                setNewComponent({
                  component_equipment_id: '',
                  component_name: '',
                  quantity: 1,
                  description: '',
                  maxQuantity: 999,
                  thumbnail_url: '',
                  technical_specs: {}
                });
              }}
              className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20"
            >
              Anuluj
            </button>
            <button onClick={handleAdd} className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90">
              Zapisz
            </button>
          </div>
        </div>
      )}

      {equipment.equipment_components?.length ? (
        <div className="space-y-3">
          {equipment.equipment_components.map((c: any) => (
            <div key={c.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
              <div className="flex items-start gap-4">
                {c.thumbnail_url && (
                  <img
                    src={c.thumbnail_url}
                    alt={c.component_name}
                    className="w-20 h-20 object-cover rounded-lg border border-[#d3bb73]/20"
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[#e5e4e2] font-medium">{c.component_name}</div>
                    {c.component_equipment_id ? (
                      <span className="text-xs px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                        Z magazynu
                      </span>
                    ) : c.is_integral && (
                      <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                        Integralny
                      </span>
                    )}
                  </div>
                  {c.description && <div className="text-sm text-[#e5e4e2]/60 mt-1">{c.description}</div>}
                  {c.technical_specs && Object.keys(c.technical_specs).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {Object.entries(c.technical_specs).map(([key, value]: [string, any]) => (
                        <div key={key} className="text-xs text-[#e5e4e2]/60">
                          <span className="font-medium">{key}:</span> {value}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-[#d3bb73] font-medium">x{c.quantity}</div>
                  {isEditing && (
                    <button onClick={() => onDelete(c.id)} className="p-2 text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak komponentów w zestawie</p>
        </div>
      )}

      <div className="border-t border-[#d3bb73]/10 pt-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">Skład opcjonalny (pasujący)</h3>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              Produkty z magazynu które pasują jako akcesoria do tego sprzętu
            </p>
          </div>
          {isEditing && (
            <button
              onClick={() => setShowCompatibleModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
            >
              <Plus className="w-4 h-4" />
              Dodaj pasujący produkt
            </button>
          )}
        </div>

        {compatibleItems.length > 0 ? (
          <div className="space-y-3">
            {compatibleItems.map((item: any) => {
              const compatEquip = item.compatible_equipment;
              const availableQty = getAvailableQuantity(compatEquip);
              const typeColors = {
                required: 'bg-red-500/20 text-red-400',
                recommended: 'bg-blue-500/20 text-blue-400',
                optional: 'bg-green-500/20 text-green-400',
              };
              const typeLabels = {
                required: 'Wymagany',
                recommended: 'Zalecany',
                optional: 'Opcjonalny',
              };

              return (
                <div key={item.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
                  <div className="flex items-start gap-4">
                    {compatEquip.thumbnail_url ? (
                      <img
                        src={compatEquip.thumbnail_url}
                        alt={compatEquip.name}
                        className="w-20 h-20 object-cover rounded-lg border border-[#d3bb73]/20"
                      />
                    ) : (
                      <div className="w-20 h-20 bg-[#0f1119] rounded-lg flex items-center justify-center border border-[#d3bb73]/20">
                        <Package className="w-8 h-8 text-[#e5e4e2]/20" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-[#e5e4e2] font-medium">{compatEquip.name}</div>
                        <span className={`text-xs px-2 py-0.5 rounded ${typeColors[item.compatibility_type as keyof typeof typeColors]}`}>
                          {typeLabels[item.compatibility_type as keyof typeof typeLabels]}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          availableQty > 0
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {availableQty} szt. dostępne
                        </span>
                      </div>
                      {compatEquip.model && (
                        <div className="text-sm text-[#e5e4e2]/60">{compatEquip.model}</div>
                      )}
                      {item.notes && (
                        <div className="text-sm text-[#e5e4e2]/60 mt-1 italic">{item.notes}</div>
                      )}
                    </div>
                    {isEditing && (
                      <button
                        onClick={() => handleDeleteCompatible(item.id)}
                        className="p-2 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
            <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60">Brak pasujących produktów</p>
            <p className="text-sm text-[#e5e4e2]/40 mt-1">
              Dodaj produkty które pasują jako akcesoria do tego sprzętu
            </p>
          </div>
        )}
      </div>

      {showCompatibleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-[#d3bb73]/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-[#e5e4e2]">Dodaj pasujący produkt</h3>
                <button
                  onClick={() => {
                    setShowCompatibleModal(false);
                    setSearchQuery('');
                    setCompatibilityNotes('');
                    setCompatibilityType('optional');
                  }}
                  className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg"
                >
                  <X className="w-5 h-5 text-[#e5e4e2]" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ kompatybilności</label>
                  <select
                    value={compatibilityType}
                    onChange={(e) => setCompatibilityType(e.target.value as any)}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="optional">Opcjonalny</option>
                    <option value="recommended">Zalecany</option>
                    <option value="required">Wymagany</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki (opcjonalne)</label>
                  <input
                    type="text"
                    value={compatibilityNotes}
                    onChange={(e) => setCompatibilityNotes(e.target.value)}
                    placeholder="np. Do montażu podestu scenicznego"
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  />
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Szukaj produktu po nazwie, modelu, marce..."
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    autoFocus
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {filteredEquipment.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredEquipment.map((item) => {
                    const availableQty = getAvailableQuantity(item);
                    const alreadyAdded = compatibleItems.some(
                      (ci: any) => ci.compatible_equipment?.id === item.id
                    );

                    return (
                      <button
                        key={item.id}
                        onClick={() => handleAddCompatible(item.id)}
                        disabled={alreadyAdded}
                        className={`bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 hover:border-[#d3bb73]/30 transition-colors text-left ${
                          alreadyAdded ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <div className="flex gap-4">
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="w-20 h-20 object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-[#0f1119] rounded-lg flex items-center justify-center">
                              <Package className="w-8 h-8 text-[#e5e4e2]/20" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-[#e5e4e2] font-medium">{item.name}</h4>
                              <span className={`text-xs px-2 py-1 rounded ${
                                availableQty > 0
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}>
                                {availableQty} szt.
                              </span>
                            </div>
                            {item.model && (
                              <p className="text-sm text-[#e5e4e2]/60 mt-0.5">{item.model}</p>
                            )}
                            {alreadyAdded && (
                              <span className="inline-block mt-2 text-xs px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded">
                                Już dodany
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showEquipmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1119] rounded-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-[#d3bb73]/10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-[#e5e4e2]">Wybierz sprzęt z magazynu</h3>
                <button
                  onClick={() => {
                    setShowEquipmentModal(false);
                    setSearchQuery('');
                  }}
                  className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg"
                >
                  <X className="w-5 h-5 text-[#e5e4e2]" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj po nazwie, modelu, marce lub kategorii..."
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg pl-10 pr-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {filteredEquipment.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredEquipment.map((item) => {
                    const availableQty = getAvailableQuantity(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectEquipment(item.id)}
                        disabled={availableQty === 0}
                        className={`bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4 hover:border-[#d3bb73]/30 transition-colors text-left ${
                          availableQty === 0 ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <div className="flex gap-4">
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="w-20 h-20 object-cover rounded-lg"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-[#0f1119] rounded-lg flex items-center justify-center">
                              <Package className="w-8 h-8 text-[#e5e4e2]/20" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="text-[#e5e4e2] font-medium">{item.name}</h4>
                              <span className={`text-xs px-2 py-1 rounded ${
                                availableQty > 0
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-red-500/20 text-red-400'
                              }`}>
                                {availableQty} szt.
                              </span>
                            </div>
                            {item.model && (
                              <p className="text-sm text-[#e5e4e2]/60 mt-0.5">{item.model}</p>
                            )}
                            {item.brand && (
                              <p className="text-xs text-[#e5e4e2]/40 mt-1">{item.brand}</p>
                            )}
                            {item.warehouse_categories && (
                              <span className="inline-block mt-2 text-xs px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded">
                                {Array.isArray(item.warehouse_categories)
                                  ? item.warehouse_categories[0]?.name
                                  : item.warehouse_categories.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}