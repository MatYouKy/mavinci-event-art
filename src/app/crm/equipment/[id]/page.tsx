'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, Save, X, Plus, Trash2, Upload, Package, History, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';

interface Category {
  id: string;
  name: string;
}

interface EquipmentStock {
  total_quantity: number;
  available_quantity: number;
  reserved_quantity: number;
  in_use_quantity: number;
  damaged_quantity: number;
  in_service_quantity: number;
  storage_location: string | null;
  min_stock_level: number;
  last_inventory_date: string | null;
}

interface Component {
  id: string;
  component_name: string;
  quantity: number;
  description: string | null;
  is_included: boolean;
}

interface GalleryImage {
  id: string;
  image_url: string;
  caption: string | null;
  order_index: number;
}

interface StockHistory {
  id: string;
  change_type: string;
  quantity_change: number;
  quantity_after: number;
  notes: string | null;
  created_at: string;
  employees: { name: string; surname: string } | null;
}

interface Equipment {
  id: string;
  name: string;
  category_id: string | null;
  brand: string | null;
  model: string | null;
  description: string | null;
  thumbnail_url: string | null;
  user_manual_url: string | null;
  weight_kg: number | null;
  dimensions_cm: any;
  purchase_date: string | null;
  purchase_price: number | null;
  current_value: number | null;
  warranty_until: string | null;
  serial_number: string | null;
  barcode: string | null;
  notes: string | null;
  is_active: boolean;
  equipment_categories: Category | null;
  equipment_stock: EquipmentStock[];
  equipment_components: Component[];
  equipment_gallery: GalleryImage[];
}

export default function EquipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const equipmentId = params.id as string;

  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'gallery' | 'stock' | 'history'>('details');

  const [editForm, setEditForm] = useState<any>({});
  const [stockHistory, setStockHistory] = useState<StockHistory[]>([]);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showGalleryUpload, setShowGalleryUpload] = useState(false);

  useEffect(() => {
    fetchEquipment();
    fetchCategories();
  }, [equipmentId]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchStockHistory();
    }
  }, [activeTab]);

  const fetchCategories = async () => {
    const { data } = await supabase
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
          equipment_categories(id, name),
          equipment_stock(*),
          equipment_components(*),
          equipment_gallery(*)
        `)
        .eq('id', equipmentId)
        .single();

      if (error) throw error;
      setEquipment(data);
      setEditForm(data);
    } catch (error) {
      console.error('Error fetching equipment:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStockHistory = async () => {
    const { data, error } = await supabase
      .from('equipment_stock_history')
      .select(`
        *,
        employees(name, surname)
      `)
      .eq('equipment_id', equipmentId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) setStockHistory(data);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm(equipment);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const dimensions = editForm.dimensions_length || editForm.dimensions_width || editForm.dimensions_height
        ? {
            length: parseFloat(editForm.dimensions_length) || null,
            width: parseFloat(editForm.dimensions_width) || null,
            height: parseFloat(editForm.dimensions_height) || null,
          }
        : null;

      const { error } = await supabase
        .from('equipment_items')
        .update({
          name: editForm.name,
          category_id: editForm.category_id,
          brand: editForm.brand || null,
          model: editForm.model || null,
          description: editForm.description || null,
          thumbnail_url: editForm.thumbnail_url || null,
          user_manual_url: editForm.user_manual_url || null,
          weight_kg: editForm.weight_kg ? parseFloat(editForm.weight_kg) : null,
          dimensions_cm: dimensions,
          purchase_date: editForm.purchase_date || null,
          purchase_price: editForm.purchase_price ? parseFloat(editForm.purchase_price) : null,
          current_value: editForm.current_value ? parseFloat(editForm.current_value) : null,
          warranty_until: editForm.warranty_until || null,
          serial_number: editForm.serial_number || null,
          barcode: editForm.barcode || null,
          notes: editForm.notes || null,
        })
        .eq('id', equipmentId);

      if (error) throw error;

      await fetchEquipment();
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving equipment:', error);
      alert('Błąd podczas zapisywania');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditForm((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadImage(file, 'equipment-thumbnails');
      setEditForm((prev: any) => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!equipment) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
      </div>
    );
  }

  const stock = equipment.equipment_stock[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">{equipment.name}</h2>
            {(equipment.brand || equipment.model) && (
              <p className="text-sm text-[#e5e4e2]/60 mt-1">
                {equipment.brand} {equipment.model}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {isEditing ? (
            <>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-2 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
              >
                <X className="w-4 h-4" />
                Anuluj
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </>
          ) : (
            <button
              onClick={handleEdit}
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Edit className="w-4 h-4" />
              Edytuj
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-[#d3bb73]/10">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'details'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          Szczegóły
        </button>
        <button
          onClick={() => setActiveTab('gallery')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'gallery'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          Galeria ({equipment.equipment_gallery.length})
        </button>
        <button
          onClick={() => setActiveTab('stock')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'stock'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          Stan magazynowy
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 text-sm transition-colors ${
            activeTab === 'history'
              ? 'text-[#d3bb73] border-b-2 border-[#d3bb73]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          Historia
        </button>
      </div>

      {activeTab === 'details' && (
        <DetailsTab
          equipment={equipment}
          editForm={editForm}
          isEditing={isEditing}
          categories={categories}
          onInputChange={handleInputChange}
          onThumbnailUpload={handleThumbnailUpload}
        />
      )}

      {activeTab === 'gallery' && (
        <GalleryTab
          equipment={equipment}
          onUpdate={fetchEquipment}
        />
      )}

      {activeTab === 'stock' && (
        <StockTab
          equipment={equipment}
          stock={stock}
          onUpdate={fetchEquipment}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab history={stockHistory} />
      )}
    </div>
  );
}

function DetailsTab({
  equipment,
  editForm,
  isEditing,
  categories,
  onInputChange,
  onThumbnailUpload,
}: any) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          {isEditing ? (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka</label>
              {editForm.thumbnail_url ? (
                <div className="space-y-2">
                  <img
                    src={editForm.thumbnail_url}
                    alt={equipment.name}
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => onInputChange({ target: { name: 'thumbnail_url', value: '' } })}
                    className="w-full text-red-400 hover:text-red-300 text-sm"
                  >
                    Usuń zdjęcie
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onThumbnailUpload}
                    className="hidden"
                    id="thumbnail-upload-edit"
                  />
                  <label
                    htmlFor="thumbnail-upload-edit"
                    className="flex items-center justify-center gap-2 w-full aspect-square bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]/60 hover:border-[#d3bb73]/30 cursor-pointer transition-colors"
                  >
                    <Upload className="w-8 h-8" />
                  </label>
                </div>
              )}
            </div>
          ) : equipment.thumbnail_url ? (
            <img
              src={equipment.thumbnail_url}
              alt={equipment.name}
              className="w-full aspect-square object-cover rounded-lg"
            />
          ) : (
            <div className="w-full aspect-square bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
              <Package className="w-16 h-16 text-[#d3bb73]" />
            </div>
          )}

          <div className="mt-6 space-y-4">
            {equipment.equipment_categories && (
              <div>
                <div className="text-sm text-[#e5e4e2]/60 mb-1">Kategoria</div>
                {isEditing ? (
                  <select
                    name="category_id"
                    value={editForm.category_id}
                    onChange={onInputChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    {categories.map((cat: any) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="inline-block px-3 py-1 rounded bg-[#d3bb73]/20 text-[#d3bb73]">
                    {equipment.equipment_categories.name}
                  </div>
                )}
              </div>
            )}

            {equipment.serial_number && (
              <div>
                <div className="text-sm text-[#e5e4e2]/60 mb-1">Numer seryjny</div>
                <div className="text-[#e5e4e2]">{equipment.serial_number}</div>
              </div>
            )}

            {equipment.barcode && (
              <div>
                <div className="text-sm text-[#e5e4e2]/60 mb-1">Kod kreskowy</div>
                <div className="text-[#e5e4e2] font-mono">{equipment.barcode}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Podstawowe informacje</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa</label>
              {isEditing ? (
                <input
                  type="text"
                  name="name"
                  value={editForm.name}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.name}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Marka</label>
              {isEditing ? (
                <input
                  type="text"
                  name="brand"
                  value={editForm.brand || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.brand || '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Model</label>
              {isEditing ? (
                <input
                  type="text"
                  name="model"
                  value={editForm.model || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.model || '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Waga</label>
              {isEditing ? (
                <input
                  type="number"
                  step="0.01"
                  name="weight_kg"
                  value={editForm.weight_kg || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.weight_kg ? `${equipment.weight_kg} kg` : '-'}
                </div>
              )}
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
              {isEditing ? (
                <textarea
                  name="description"
                  value={editForm.description || ''}
                  onChange={onInputChange}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.description || '-'}</div>
              )}
            </div>
          </div>
        </div>

        {equipment.equipment_components && equipment.equipment_components.length > 0 && (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Skład zestawu</h3>
            <div className="space-y-2">
              {equipment.equipment_components.map((component: Component) => (
                <div
                  key={component.id}
                  className="flex items-center justify-between p-3 bg-[#0f1119] rounded-lg"
                >
                  <div className="flex-1">
                    <div className="text-[#e5e4e2] font-medium">{component.component_name}</div>
                    {component.description && (
                      <div className="text-sm text-[#e5e4e2]/60">{component.description}</div>
                    )}
                  </div>
                  <div className="text-[#d3bb73] font-medium">x{component.quantity}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {equipment.notes && (
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Notatki</h3>
            <div className="text-[#e5e4e2]/80">{equipment.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryTab({ equipment, onUpdate }: any) {
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const url = await uploadImage(file, 'equipment-gallery');

        const maxOrder = equipment.equipment_gallery.length > 0
          ? Math.max(...equipment.equipment_gallery.map((img: any) => img.order_index))
          : -1;

        await supabase.from('equipment_gallery').insert({
          equipment_id: equipment.id,
          image_url: url,
          order_index: maxOrder + 1,
        });
      }

      onUpdate();
    } catch (error) {
      console.error('Error uploading images:', error);
      alert('Błąd podczas przesyłania zdjęć');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      await supabase.from('equipment_gallery').delete().eq('id', imageId);
      onUpdate();
    } catch (error) {
      console.error('Error deleting image:', error);
      alert('Błąd podczas usuwania zdjęcia');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Galeria zdjęć</h3>
        <div>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
            id="gallery-upload"
          />
          <label
            htmlFor="gallery-upload"
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg cursor-pointer hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Przesyłanie...' : 'Dodaj zdjęcia'}
          </label>
        </div>
      </div>

      {equipment.equipment_gallery.length === 0 ? (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <ImageIcon className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak zdjęć w galerii</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {equipment.equipment_gallery.map((image: GalleryImage) => (
            <div key={image.id} className="relative group">
              <img
                src={image.image_url}
                alt={image.caption || ''}
                className="w-full aspect-square object-cover rounded-lg"
              />
              <button
                onClick={() => handleDeleteImage(image.id)}
                className="absolute top-2 right-2 p-2 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StockTab({ equipment, stock, onUpdate }: any) {
  const [showModal, setShowModal] = useState(false);
  const [changeType, setChangeType] = useState('add');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleStockChange = async () => {
    if (!quantity || parseInt(quantity) === 0) {
      alert('Wprowadź ilość');
      return;
    }

    setSaving(true);
    try {
      const qty = changeType === 'remove' || changeType === 'damage'
        ? -Math.abs(parseInt(quantity))
        : Math.abs(parseInt(quantity));

      const { error } = await supabase.rpc('update_equipment_stock_with_history', {
        p_equipment_id: equipment.id,
        p_change_type: changeType,
        p_quantity_change: qty,
        p_employee_id: null,
        p_notes: notes || null,
      });

      if (error) throw error;

      setShowModal(false);
      setQuantity('');
      setNotes('');
      onUpdate();
    } catch (error) {
      console.error('Error updating stock:', error);
      alert('Błąd podczas aktualizacji stanu magazynowego');
    } finally {
      setSaving(false);
    }
  };

  if (!stock) {
    return (
      <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
        <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Brak danych o stanie magazynowym</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Stan magazynowy</h3>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Zmień stan
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Łącznie</div>
          <div className="text-3xl font-light text-[#e5e4e2]">{stock.total_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-green-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Dostępne</div>
          <div className="text-3xl font-light text-green-400">{stock.available_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-blue-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">W użyciu</div>
          <div className="text-3xl font-light text-blue-400">{stock.in_use_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-yellow-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Zarezerwowane</div>
          <div className="text-3xl font-light text-yellow-400">{stock.reserved_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-red-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">Uszkodzone</div>
          <div className="text-3xl font-light text-red-400">{stock.damaged_quantity}</div>
        </div>

        <div className="bg-[#1c1f33] border border-orange-500/10 rounded-xl p-6">
          <div className="text-sm text-[#e5e4e2]/60 mb-2">W serwisie</div>
          <div className="text-3xl font-light text-orange-400">{stock.in_service_quantity}</div>
        </div>
      </div>

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-sm text-[#e5e4e2]/60 mb-1">Lokalizacja</div>
            <div className="text-[#e5e4e2]">{stock.storage_location || '-'}</div>
          </div>
          <div>
            <div className="text-sm text-[#e5e4e2]/60 mb-1">Minimalny poziom</div>
            <div className="text-[#e5e4e2]">{stock.min_stock_level}</div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-md w-full p-6">
            <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Zmień stan magazynowy</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ zmiany</label>
                <select
                  value={changeType}
                  onChange={(e) => setChangeType(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                >
                  <option value="add">Dodaj do magazynu</option>
                  <option value="remove">Usuń z magazynu</option>
                  <option value="rent">Wypożycz</option>
                  <option value="return">Zwrot</option>
                  <option value="damage">Uszkodzenie</option>
                  <option value="repair">Naprawa</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ilość</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="0"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatka</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  placeholder="Opcjonalna notatka..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleStockChange}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ history }: { history: StockHistory[] }) {
  const getChangeTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      add: 'Dodano',
      remove: 'Usunięto',
      purchase: 'Zakup',
      rent: 'Wypożyczenie',
      return: 'Zwrot',
      damage: 'Uszkodzenie',
      repair: 'Naprawa',
    };
    return labels[type] || type;
  };

  const getChangeTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      add: 'text-green-400',
      purchase: 'text-green-400',
      return: 'text-green-400',
      repair: 'text-green-400',
      remove: 'text-red-400',
      rent: 'text-blue-400',
      damage: 'text-red-400',
    };
    return colors[type] || 'text-[#e5e4e2]';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-[#e5e4e2]">Historia zmian</h3>

      {history.length === 0 ? (
        <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
          <History className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak historii zmian</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`font-medium ${getChangeTypeColor(entry.change_type)}`}>
                      {getChangeTypeLabel(entry.change_type)}
                    </span>
                    <span className="text-[#e5e4e2]">
                      {entry.quantity_change > 0 ? '+' : ''}{entry.quantity_change} szt.
                    </span>
                    <span className="text-[#e5e4e2]/60 text-sm">
                      → Stan: {entry.quantity_after}
                    </span>
                  </div>
                  {entry.notes && (
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">{entry.notes}</div>
                  )}
                  <div className="text-xs text-[#e5e4e2]/40">
                    {new Date(entry.created_at).toLocaleString('pl-PL')}
                    {entry.employees && (
                      <span> • {entry.employees.name} {entry.employees.surname}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
