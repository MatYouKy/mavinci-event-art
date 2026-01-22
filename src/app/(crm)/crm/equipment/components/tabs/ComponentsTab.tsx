import { useState, useEffect } from 'react';
import { Plus, Trash2, Package, Search, X, Upload, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { uploadImage } from '@/lib/storage';

interface EquipmentItem {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  thumbnail_url: string | null;
  cable_stock_quantity?: number | null;
  equipment_units?: Array<{ id: string; status: string }>;
  warehouse_categories?:
    | {
        name: string;
      }
    | Array<{ name: string }>;
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
    technical_specs: {} as Record<string, string>,
    is_optional: false,
  });
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [techSpecKey, setTechSpecKey] = useState('');
  const [techSpecValue, setTechSpecValue] = useState('');

  const [compatibleItems, setCompatibleItems] = useState<any[]>([]);
  const [showCompatibleModal, setShowCompatibleModal] = useState(false);
  const [compatibilityType, setCompatibilityType] = useState<
    'required' | 'recommended' | 'optional'
  >('optional');
  const [compatibilityNotes, setCompatibilityNotes] = useState('');
  const [showComponentDetailModal, setShowComponentDetailModal] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<any>(null);

  const getAvailableQuantity = (item: EquipmentItem): number => {
    if (
      item.cable_stock_quantity !== undefined &&
      item.cable_stock_quantity !== null &&
      item.cable_stock_quantity > 0
    ) {
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
        availableEquipment.filter((item) => {
          const categoryName = Array.isArray(item.warehouse_categories)
            ? item.warehouse_categories[0]?.name
            : item.warehouse_categories?.name;
          return (
            item.name.toLowerCase().includes(query) ||
            item.model?.toLowerCase().includes(query) ||
            item.brand?.toLowerCase().includes(query) ||
            categoryName?.toLowerCase().includes(query)
          );
        }),
      );
    }
  }, [searchQuery, availableEquipment]);

  const fetchAvailableEquipment = async () => {
    const { data, error } = await supabase
      .from('equipment_items')
      .select(
        `
        id,
        name,
        model,
        brand,
        thumbnail_url,
        cable_stock_quantity,
        warehouse_categories(name),
        equipment_units(id, status)
      `,
      )
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
      .select(
        `
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
      `,
      )
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
      const { error } = await supabase.from('equipment_compatible_items').insert({
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
      const { error } = await supabase.from('equipment_compatible_items').delete().eq('id', id);

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
        quantity: Math.min(p.quantity, maxQty),
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
        [techSpecKey]: techSpecValue,
      },
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

    const selectedEquipment = availableEquipment.find(
      (e) => e.id === newComponent.component_equipment_id,
    );

    await onAdd({
      equipment_id: equipment.id,
      component_equipment_id:
        componentType === 'from_warehouse' ? newComponent.component_equipment_id : null,
      component_name:
        componentType === 'from_warehouse'
          ? selectedEquipment
            ? `${selectedEquipment.name}${selectedEquipment.model ? ` ${selectedEquipment.model}` : ''}`
            : ''
          : newComponent.component_name,
      quantity: newComponent.quantity,
      description: newComponent.description || null,
      is_included: !newComponent.is_optional,
      is_integral: componentType === 'custom',
      is_optional: newComponent.is_optional,
      thumbnail_url: componentType === 'custom' ? newComponent.thumbnail_url || null : null,
      technical_specs:
        componentType === 'custom' && Object.keys(newComponent.technical_specs).length > 0
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
      technical_specs: {},
      is_optional: false,
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
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj komponent
          </button>
        )}
      </div>

      {isAdding && (
        <div className="space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                checked={componentType === 'from_warehouse'}
                onChange={() => setComponentType('from_warehouse')}
                className="h-4 w-4 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-[#e5e4e2]">Z magazynu</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                checked={componentType === 'custom'}
                onChange={() => setComponentType('custom')}
                className="h-4 w-4 text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-[#e5e4e2]">Własna nazwa</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {componentType === 'from_warehouse' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowEquipmentModal(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-left text-[#e5e4e2] hover:border-[#d3bb73]/30"
                >
                  <span className={newComponent.component_name ? '' : 'text-[#e5e4e2]/50'}>
                    {newComponent.component_name || 'Wybierz sprzęt z magazynu'}
                  </span>
                  <Search className="h-4 w-4" />
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
                className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
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
                  const maxQty =
                    componentType === 'from_warehouse' ? newComponent.maxQuantity : 999;
                  setNewComponent((p) => ({ ...p, quantity: Math.min(Math.max(val, 1), maxQty) }));
                }}
                placeholder="Ilość"
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
              {componentType === 'from_warehouse' && newComponent.component_equipment_id && (
                <div className="text-xs text-[#e5e4e2]/60">Maks: {newComponent.maxQuantity}</div>
              )}
            </div>
            <input
              type="text"
              value={newComponent.description}
              onChange={(e) => setNewComponent((p) => ({ ...p, description: e.target.value }))}
              placeholder="Opis (opcjonalnie)"
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <input
              type="checkbox"
              id="is-optional-checkbox"
              checked={newComponent.is_optional}
              onChange={(e) => setNewComponent((p) => ({ ...p, is_optional: e.target.checked }))}
              className="h-4 w-4 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]"
            />
            <label htmlFor="is-optional-checkbox" className="cursor-pointer text-[#e5e4e2]">
              Komponent opcjonalny (nie wliczony domyślnie w zestaw)
            </label>
          </div>

          {componentType === 'custom' && (
            <div className="space-y-4 border-t border-[#d3bb73]/10 pt-4">
              <h4 className="text-sm font-medium text-[#e5e4e2]">
                Komponent integralny - Szczegóły
              </h4>

              {newComponent.thumbnail_url && (
                <div className="relative h-32 w-32">
                  <img
                    src={newComponent.thumbnail_url}
                    alt="Miniaturka"
                    className="h-full w-full rounded-lg border border-[#d3bb73]/20 object-cover"
                  />
                  <button
                    onClick={() => setNewComponent((prev) => ({ ...prev, thumbnail_url: '' }))}
                    className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Zdjęcie komponentu (opcjonalne)
                </label>
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
                  className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/30 ${
                    uploadingThumb ? 'opacity-50' : ''
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  {uploadingThumb
                    ? 'Przesyłanie...'
                    : newComponent.thumbnail_url
                      ? 'Zmień zdjęcie'
                      : 'Dodaj zdjęcie'}
                </label>
              </div>

              <div className="space-y-2">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Parametry techniczne</label>
                {Object.entries(newComponent.technical_specs).length > 0 && (
                  <div className="mb-3 space-y-2">
                    {Object.entries(newComponent.technical_specs).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2"
                      >
                        <span className="flex-1 text-[#e5e4e2]">
                          <span className="font-medium">{key}:</span> {value}
                        </span>
                        <button
                          onClick={() => handleRemoveTechSpec(key)}
                          className="p-1 text-red-400 hover:text-red-300"
                        >
                          <X className="h-4 w-4" />
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
                    className="flex-1 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  />
                  <input
                    type="text"
                    value={techSpecValue}
                    onChange={(e) => setTechSpecValue(e.target.value)}
                    placeholder="Wartość (np. 500W)"
                    className="flex-1 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  />
                  <button
                    onClick={handleAddTechSpec}
                    className="rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/30"
                  >
                    <Plus className="h-4 w-4" />
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
                  technical_specs: {},
                  is_optional: false,
                });
              }}
              className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
            >
              Anuluj
            </button>
            <button
              onClick={handleAdd}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Zapisz
            </button>
          </div>
        </div>
      )}

      {equipment.equipment_components?.filter((c: any) => !c.is_optional).length ? (
        <div className="space-y-3">
          {equipment.equipment_components
            .filter((c: any) => !c.is_optional)
            .map((c: any) => {
              const thumbnailUrl = c.thumbnail_url || c.equipment_items?.thumbnail_url;
              const hasDetails = c.technical_specs && Object.keys(c.technical_specs).length > 0;

              return (
                <div key={c.id} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                  <div className="flex items-start gap-4">
                    <button
                      onClick={() => {
                        setSelectedComponent(c);
                        setShowComponentDetailModal(true);
                      }}
                      className="flex-shrink-0 transition-opacity hover:opacity-80"
                    >
                      {thumbnailUrl ? (
                        <img
                          src={thumbnailUrl}
                          alt={c.component_name}
                          className="h-20 w-20 rounded-lg border border-[#d3bb73]/20 object-cover"
                        />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
                          <Package className="h-8 w-8 text-[#e5e4e2]/20" />
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedComponent(c);
                        setShowComponentDetailModal(true);
                      }}
                      className="-m-2 flex-1 rounded-lg p-2 text-left transition-colors hover:bg-[#d3bb73]/5"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <div className="font-medium text-[#e5e4e2]">{c.component_name}</div>
                        {c.component_equipment_id ? (
                          <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                            Z magazynu
                          </span>
                        ) : (
                          c.is_integral && (
                            <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                              Integralny
                            </span>
                          )
                        )}
                      </div>
                      {c.description && (
                        <div className="mt-1 text-sm text-[#e5e4e2]/60">{c.description}</div>
                      )}
                      {hasDetails && (
                        <div className="mt-2 space-y-1">
                          {Object.entries(c.technical_specs)
                            .slice(0, 2)
                            .map(([key, value]: [string, any]) => (
                              <div key={key} className="text-xs text-[#e5e4e2]/60">
                                <span className="font-medium">{key}:</span> {value}
                              </div>
                            ))}
                          {Object.keys(c.technical_specs).length > 2 && (
                            <div className="cursor-pointer text-xs italic text-[#d3bb73] hover:underline">
                              +{Object.keys(c.technical_specs).length - 2} więcej parametrów
                              (kliknij aby zobaczyć)
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="font-medium text-[#d3bb73]">x{c.quantity}</div>
                      {isEditing && (
                        <button
                          onClick={() => onDelete(c.id)}
                          className="p-2 text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] py-12 text-center">
          <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak komponentów w zestawie</p>
        </div>
      )}

      <div className="mt-6 border-t border-[#d3bb73]/10 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">Skład opcjonalny (pasujący)</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Opcjonalne komponenty i produkty z magazynu które pasują jako akcesoria
            </p>
          </div>
          {isEditing && (
            <button
              onClick={() => setShowCompatibleModal(true)}
              className="flex items-center gap-2 rounded-lg bg-purple-500 px-4 py-2 text-white hover:bg-purple-600"
            >
              <Plus className="h-4 w-4" />
              Dodaj pasujący produkt
            </button>
          )}
        </div>

        {equipment.equipment_components?.filter((c: any) => c.is_optional).length > 0 ||
        compatibleItems.length > 0 ? (
          <div className="space-y-3">
            {equipment.equipment_components
              ?.filter((c: any) => c.is_optional)
              .map((c: any) => {
                const thumbnailUrl = c.thumbnail_url || c.equipment_items?.thumbnail_url;
                const hasDetails = c.technical_specs && Object.keys(c.technical_specs).length > 0;

                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <div className="flex items-start gap-4">
                      <button
                        onClick={() => {
                          setSelectedComponent(c);
                          setShowComponentDetailModal(true);
                        }}
                        className="flex-shrink-0 transition-opacity hover:opacity-80"
                      >
                        {thumbnailUrl ? (
                          <img
                            src={thumbnailUrl}
                            alt={c.component_name}
                            className="h-20 w-20 rounded-lg border border-[#d3bb73]/20 object-cover"
                          />
                        ) : (
                          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
                            <Package className="h-8 w-8 text-[#e5e4e2]/20" />
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setSelectedComponent(c);
                          setShowComponentDetailModal(true);
                        }}
                        className="-m-2 flex-1 rounded-lg p-2 text-left transition-colors hover:bg-[#d3bb73]/5"
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <div className="font-medium text-[#e5e4e2]">{c.component_name}</div>
                          <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                            Opcjonalny
                          </span>
                          {c.component_equipment_id ? (
                            <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                              Z magazynu
                            </span>
                          ) : (
                            c.is_integral && (
                              <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                                Integralny
                              </span>
                            )
                          )}
                        </div>
                        {c.description && (
                          <div className="mt-1 text-sm text-[#e5e4e2]/60">{c.description}</div>
                        )}
                        {hasDetails && (
                          <div className="mt-2 space-y-1">
                            {Object.entries(c.technical_specs)
                              .slice(0, 2)
                              .map(([key, value]: [string, any]) => (
                                <div key={key} className="text-xs text-[#e5e4e2]/60">
                                  <span className="font-medium">{key}:</span> {value}
                                </div>
                              ))}
                            {Object.keys(c.technical_specs).length > 2 && (
                              <div className="cursor-pointer text-xs italic text-[#d3bb73] hover:underline">
                                +{Object.keys(c.technical_specs).length - 2} więcej parametrów
                                (kliknij aby zobaczyć)
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                      <div className="flex items-center gap-3">
                        <div className="font-medium text-[#d3bb73]">x{c.quantity}</div>
                        {isEditing && (
                          <button
                            onClick={() => onDelete(c.id)}
                            className="p-2 text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
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
                <div
                  key={item.id}
                  className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                >
                  <div className="flex items-start gap-4">
                    {compatEquip.thumbnail_url ? (
                      <img
                        src={compatEquip.thumbnail_url}
                        alt={compatEquip.name}
                        className="h-20 w-20 rounded-lg border border-[#d3bb73]/20 object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
                        <Package className="h-8 w-8 text-[#e5e4e2]/20" />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <div className="font-medium text-[#e5e4e2]">{compatEquip.name}</div>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${typeColors[item.compatibility_type as keyof typeof typeColors]}`}
                        >
                          {typeLabels[item.compatibility_type as keyof typeof typeLabels]}
                        </span>
                        <span
                          className={`rounded px-2 py-1 text-xs ${
                            availableQty > 0
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {availableQty} szt. dostępne
                        </span>
                      </div>
                      {compatEquip.model && (
                        <div className="text-sm text-[#e5e4e2]/60">{compatEquip.model}</div>
                      )}
                      {item.notes && (
                        <div className="mt-1 text-sm italic text-[#e5e4e2]/60">{item.notes}</div>
                      )}
                    </div>
                    {isEditing && (
                      <button
                        onClick={() => handleDeleteCompatible(item.id)}
                        className="p-2 text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] py-12 text-center">
            <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">
              Brak opcjonalnych komponentów i pasujących produktów
            </p>
            <p className="mt-1 text-sm text-[#e5e4e2]/40">
              Zaznacz checkbox "Opcjonalny" przy dodawaniu komponentu lub dodaj produkty z magazynu
            </p>
          </div>
        )}
      </div>

      {showCompatibleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-[#0f1119]">
            <div className="border-b border-[#d3bb73]/10 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-[#e5e4e2]">Dodaj pasujący produkt</h3>
                <button
                  onClick={() => {
                    setShowCompatibleModal(false);
                    setSearchQuery('');
                    setCompatibilityNotes('');
                    setCompatibilityType('optional');
                  }}
                  className="rounded-lg p-2 hover:bg-[#e5e4e2]/10"
                >
                  <X className="h-5 w-5 text-[#e5e4e2]" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Typ kompatybilności
                  </label>
                  <select
                    value={compatibilityType}
                    onChange={(e) => setCompatibilityType(e.target.value as any)}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  >
                    <option value="optional">Opcjonalny</option>
                    <option value="recommended">Zalecany</option>
                    <option value="required">Wymagany</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Notatki (opcjonalne)
                  </label>
                  <input
                    type="text"
                    value={compatibilityNotes}
                    onChange={(e) => setCompatibilityNotes(e.target.value)}
                    placeholder="np. Do montażu podestu scenicznego"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Szukaj produktu po nazwie, modelu, marce..."
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-3 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {filteredEquipment.length === 0 ? (
                <div className="py-12 text-center">
                  <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filteredEquipment.map((item) => {
                    const availableQty = getAvailableQuantity(item);
                    const alreadyAdded = compatibleItems.some(
                      (ci: any) => ci.compatible_equipment?.id === item.id,
                    );

                    return (
                      <button
                        key={item.id}
                        onClick={() => handleAddCompatible(item.id)}
                        disabled={alreadyAdded}
                        className={`rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 text-left transition-colors hover:border-[#d3bb73]/30 ${
                          alreadyAdded ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        <div className="flex gap-4">
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="h-20 w-20 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-[#0f1119]">
                              <Package className="h-8 w-8 text-[#e5e4e2]/20" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-medium text-[#e5e4e2]">{item.name}</h4>
                              <span
                                className={`rounded px-2 py-1 text-xs ${
                                  availableQty > 0
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-red-500/20 text-red-400'
                                }`}
                              >
                                {availableQty} szt.
                              </span>
                            </div>
                            {item.model && (
                              <p className="mt-0.5 text-sm text-[#e5e4e2]/60">{item.model}</p>
                            )}
                            {alreadyAdded && (
                              <span className="mt-2 inline-block rounded bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-xl bg-[#0f1119]">
            <div className="border-b border-[#d3bb73]/10 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-[#e5e4e2]">Wybierz sprzęt z magazynu</h3>
                <button
                  onClick={() => {
                    setShowEquipmentModal(false);
                    setSearchQuery('');
                  }}
                  className="rounded-lg p-2 hover:bg-[#e5e4e2]/10"
                >
                  <X className="h-5 w-5 text-[#e5e4e2]" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj po nazwie, modelu, marce lub kategorii..."
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-3 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {filteredEquipment.length === 0 ? (
                <div className="py-12 text-center">
                  <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                  <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filteredEquipment.map((item) => {
                    const availableQty = getAvailableQuantity(item);
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectEquipment(item.id)}
                        disabled={availableQty === 0}
                        className={`rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 text-left transition-colors hover:border-[#d3bb73]/30 ${
                          availableQty === 0 ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        <div className="flex gap-4">
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="h-20 w-20 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-[#0f1119]">
                              <Package className="h-8 w-8 text-[#e5e4e2]/20" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-medium text-[#e5e4e2]">{item.name}</h4>
                              <span
                                className={`rounded px-2 py-1 text-xs ${
                                  availableQty > 0
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-red-500/20 text-red-400'
                                }`}
                              >
                                {availableQty} szt.
                              </span>
                            </div>
                            {item.model && (
                              <p className="mt-0.5 text-sm text-[#e5e4e2]/60">{item.model}</p>
                            )}
                            {item.brand && (
                              <p className="mt-1 text-xs text-[#e5e4e2]/40">{item.brand}</p>
                            )}
                            {item.warehouse_categories && (
                              <span className="mt-2 inline-block rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
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

      {showComponentDetailModal && selectedComponent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[#0f1119]">
            <div className="border-b border-[#d3bb73]/10 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-[#e5e4e2]">Szczegóły komponentu</h3>
                <button
                  onClick={() => {
                    setShowComponentDetailModal(false);
                    setSelectedComponent(null);
                  }}
                  className="rounded-lg p-2 hover:bg-[#e5e4e2]/10"
                >
                  <X className="h-5 w-5 text-[#e5e4e2]" />
                </button>
              </div>
            </div>

            <div className="space-y-6 p-6">
              {(selectedComponent.thumbnail_url ||
                selectedComponent.equipment_items?.thumbnail_url) && (
                <div className="flex justify-center">
                  <img
                    src={
                      selectedComponent.thumbnail_url ||
                      selectedComponent.equipment_items?.thumbnail_url
                    }
                    alt={selectedComponent.component_name}
                    className="h-auto max-h-96 max-w-full rounded-lg border border-[#d3bb73]/20 object-contain"
                  />
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-lg font-medium text-[#e5e4e2]">
                    {selectedComponent.component_name}
                  </h4>
                  {selectedComponent.component_equipment_id ? (
                    <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                      Z magazynu
                    </span>
                  ) : (
                    selectedComponent.is_integral && (
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-400">
                        Integralny
                      </span>
                    )
                  )}
                </div>
                <div className="text-sm text-[#e5e4e2]/60">
                  Ilość:{' '}
                  <span className="font-medium text-[#d3bb73]">x{selectedComponent.quantity}</span>
                </div>
              </div>

              {selectedComponent.description && (
                <div>
                  <h5 className="mb-2 text-sm font-medium text-[#e5e4e2]">Opis</h5>
                  <p className="text-sm text-[#e5e4e2]/80">{selectedComponent.description}</p>
                </div>
              )}

              {selectedComponent.technical_specs &&
                Object.keys(selectedComponent.technical_specs).length > 0 && (
                  <div>
                    <h5 className="mb-3 text-sm font-medium text-[#e5e4e2]">
                      Parametry techniczne
                    </h5>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {Object.entries(selectedComponent.technical_specs).map(
                        ([key, value]: [string, any]) => (
                          <div
                            key={key}
                            className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-3"
                          >
                            <div className="mb-1 text-xs text-[#e5e4e2]/60">{key}</div>
                            <div className="text-sm font-medium text-[#e5e4e2]">{value}</div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}

              {selectedComponent.component_equipment_id && selectedComponent.equipment_items && (
                <div className="border-t border-[#d3bb73]/10 pt-6">
                  <h5 className="mb-3 text-sm font-medium text-[#e5e4e2]">
                    Informacje o produkcie z magazynu
                  </h5>
                  <div className="space-y-2 text-sm">
                    {selectedComponent.equipment_items.name && (
                      <div>
                        <span className="text-[#e5e4e2]/60">Nazwa: </span>
                        <span className="text-[#e5e4e2]">
                          {selectedComponent.equipment_items.name}
                        </span>
                      </div>
                    )}
                    {selectedComponent.equipment_items.model && (
                      <div>
                        <span className="text-[#e5e4e2]/60">Model: </span>
                        <span className="text-[#e5e4e2]">
                          {selectedComponent.equipment_items.model}
                        </span>
                      </div>
                    )}
                    {selectedComponent.equipment_items.brand && (
                      <div>
                        <span className="text-[#e5e4e2]/60">Marka: </span>
                        <span className="text-[#e5e4e2]">
                          {selectedComponent.equipment_items.brand}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end border-t border-[#d3bb73]/10 pt-4">
                <button
                  onClick={() => {
                    setShowComponentDetailModal(false);
                    setSelectedComponent(null);
                  }}
                  className="rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  Zamknij
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
